/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { readJson } = require('../shared');
const {
  readHistoricalSourceSizeBaselines,
  sourceSizeHistoryViolations,
  sourceSizeRatchetViolations,
} = require('./sourceSizeRatchet');
const { readDevelopmentManifest } = require('./manifest');
const { textCompare } = require('./manifest/contract');
const {
  codeFileStemViolations,
  ownerCodeFiles,
  ownerContractViolations,
  testFileLineViolations,
  testLayoutViolations,
} = require('./layout');
const {
  dependencyGraph: buildDependencyGraph,
  importSpecifiers,
  sourceFiles,
} = require('./moduleGraph');

const repoRoot = path.resolve(__dirname, '..', '..');
const developmentManifest = readDevelopmentManifest(repoRoot);
const architecturePolicy = developmentManifest.architecture;
const qualityPolicy = developmentManifest.quality;
const tsConfigPath = path.join(repoRoot, 'tsconfig.json');
const sourceSizeBaselinePath = path.join(__dirname, 'source-size-baseline.json');
const tsConfig = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
if (tsConfig.error) {
  throw new Error(ts.flattenDiagnosticMessageText(tsConfig.error.messageText, '\n'));
}
const compilerOptions = ts.parseJsonConfigFileContent(tsConfig.config, ts.sys, repoRoot).options;
const dependencyGraph = (files, sources) => buildDependencyGraph(files, sources, compilerOptions);
const workspaceOwnersIn = (scope) =>
  fs
    .readdirSync(path.join(repoRoot, scope), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => textCompare(left.name, right.name))
    .map((entry) => path.join(repoRoot, scope, entry.name))
    .filter((directory) => fs.existsSync(path.join(directory, 'package.json')))
    .map((directory) => ({ directory }));

const workspacePackagesIn = (scope) =>
  workspaceOwnersIn(scope)
    .map(({ directory }) => directory)
    .filter((directory) => fs.existsSync(path.join(directory, 'src')))
    .map((directory) => {
      const manifest = readJson(path.join(directory, 'package.json'));
      return {
        name: manifest.name,
        directory,
        sourceRoot: path.join(directory, 'src'),
        dependencies: new Set(
          Object.keys({
            ...manifest.dependencies,
            ...manifest.devDependencies,
            ...manifest.optionalDependencies,
            ...manifest.peerDependencies,
          }),
        ),
      };
    });

const workspacePackages = architecturePolicy.workspaceSourceScopes.flatMap(workspacePackagesIn);
const ownerWorkspaces = architecturePolicy.workspaceSourceScopes.flatMap(workspaceOwnersIn);
const sourceRoots = workspacePackages.map(({ sourceRoot }) => sourceRoot);
const maxFileLines = qualityPolicy.maxSourceFileLines;
const maxFileStemLength = qualityPolicy.maxCodeFileStemLength;
const maxFunctionLines = qualityPolicy.maxFunctionLines;
const maxTestFileLines = qualityPolicy.ownerLayout.maxTestFileLines;
const sourceSizeRatchetLines = qualityPolicy.newSourceFileRatchetLines;

const relativePath = (file) => path.relative(repoRoot, file).replace(/\\/g, '/');

const lineCount = (source) => source.split(/\r?\n/).length;

const functionName = (node, sourceFile) => {
  if (node.name) return node.name.getText(sourceFile);
  if (node.parent && ts.isVariableDeclaration(node.parent) && node.parent.name) {
    return node.parent.name.getText(sourceFile);
  }
  return '<anonymous>';
};

const oversizedFunctions = (file, source) => {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const findings = [];
  const visit = (node) => {
    if (ts.isFunctionLike(node) && node.body) {
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const end = sourceFile.getLineAndCharacterOfPosition(node.end).line + 1;
      if (end - start + 1 > maxFunctionLines) {
        findings.push({
          file: relativePath(file),
          name: functionName(node, sourceFile),
          start,
          lines: end - start + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
};

const unsafeTypeEscapes = (file, source) => {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const findings = [];
  const report = (node, kind) => {
    findings.push({
      file: relativePath(file),
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
      kind,
    });
  };
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      report(node, 'explicit any');
    }
    if (
      ts.isAsExpression(node) &&
      ts.isAsExpression(node.expression) &&
      (node.expression.type.kind === ts.SyntaxKind.UnknownKeyword ||
        node.expression.type.kind === ts.SyntaxKind.AnyKeyword)
    ) {
      report(node, 'double assertion');
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
};

const dependencyCycles = (graph) => {
  let nextIndex = 0;
  const indexes = new Map();
  const lowLinks = new Map();
  const stack = [];
  const stacked = new Set();
  const cycles = [];
  const visit = (file) => {
    indexes.set(file, nextIndex);
    lowLinks.set(file, nextIndex);
    nextIndex += 1;
    stack.push(file);
    stacked.add(file);
    for (const target of graph.get(file)) {
      if (!indexes.has(target)) {
        visit(target);
        lowLinks.set(file, Math.min(lowLinks.get(file), lowLinks.get(target)));
      } else if (stacked.has(target)) {
        lowLinks.set(file, Math.min(lowLinks.get(file), indexes.get(target)));
      }
    }
    if (lowLinks.get(file) !== indexes.get(file)) return;
    const component = [];
    let current;
    do {
      current = stack.pop();
      stacked.delete(current);
      component.push(current);
    } while (current !== file);
    if (component.length > 1) cycles.push(component);
  };
  for (const file of graph.keys()) {
    if (!indexes.has(file)) visit(file);
  }
  return cycles;
};

/**
 * Directional boundaries are stricter than cycle freedom. A dependency can
 * be acyclic and still invert the architecture, so keep the stable semantic
 * layers unaware of orchestration and mutation layers.
 */
const forbiddenDependencyRules = architecturePolicy.forbiddenDependencies;

const dependencyDirectionViolations = (graph) => {
  const violations = [];
  for (const [sourceFile, targets] of graph) {
    const source = relativePath(sourceFile);
    for (const rule of forbiddenDependencyRules) {
      if (!source.startsWith(rule.source)) continue;
      for (const targetFile of targets) {
        const target = relativePath(targetFile);
        if (rule.targets.some((prefix) => target.startsWith(prefix))) {
          violations.push({ source, target });
        }
      }
    }
  }
  return violations;
};

const undeclaredWorkspaceDependencies = (files, sources) => {
  const workspaceNames = workspacePackages
    .map(({ name }) => name)
    .filter((name) => typeof name === 'string')
    .sort((left, right) => right.length - left.length);
  const findings = new Map();
  for (const file of files) {
    const owner = workspacePackages.find(({ sourceRoot }) =>
      file.startsWith(`${sourceRoot}${path.sep}`),
    );
    if (!owner) continue;
    for (const specifier of importSpecifiers(sources.get(file))) {
      const target = workspaceNames.find(
        (name) => specifier === name || specifier.startsWith(`${name}/`),
      );
      if (!target || target === owner.name || owner.dependencies.has(target)) {
        continue;
      }
      const finding = {
        file: relativePath(file),
        owner: owner.name,
        target,
      };
      findings.set(`${finding.file}:${target}`, finding);
    }
  }
  return [...findings.values()];
};

const retiredOwnerPathViolations = (files, sources) => {
  const retiredPaths = [
    ['packages', 'engine-core', 'src', 'project', 'program', 'design'],
    ['packages', 'engine-core', 'src', 'compiler', 'program', 'design'],
    ['project', 'program', 'design'],
    ['compiler', 'program', 'design'],
  ].map((segments) => segments.join('/'));
  return files.flatMap((file) => {
    const source = sources.get(file) || '';
    return retiredPaths.some((retiredPath) => source.includes(retiredPath))
      ? [{ file: relativePath(file) }]
      : [];
  });
};

const collectLayoutFindings = (fileStats, namedFiles) => {
  const relativeNamed = namedFiles.map(relativePath);
  const sourceSizeBaseline = readJson(sourceSizeBaselinePath);
  return {
    oversizedFiles: fileStats.filter(({ lines }) => lines > maxFileLines),
    oversizedFileStems: codeFileStemViolations(relativeNamed, maxFileStemLength),
    contractLayoutRegressions: ownerContractViolations(
      relativeNamed,
      qualityPolicy.ownerLayout.contractFile,
    ),
    testLayoutRegressions: testLayoutViolations(relativeNamed, qualityPolicy.ownerLayout),
    testFileLineRegressions: testFileLineViolations(
      namedFiles.map((file) => ({
        file: relativePath(file),
        lines: lineCount(fs.readFileSync(file, 'utf8')),
      })),
      maxTestFileLines,
    ),
    sourceSizeRegressions: sourceSizeRatchetViolations(
      fileStats,
      sourceSizeBaseline,
      sourceSizeRatchetLines,
    ),
    sourceSizeHistoryRegressions: sourceSizeHistoryViolations(
      sourceSizeBaseline,
      readHistoricalSourceSizeBaselines({
        repoRoot,
        baselinePath: sourceSizeBaselinePath,
        currentBaseline: sourceSizeBaseline,
      }),
      sourceSizeRatchetLines,
    ),
  };
};

const collectSourceAndGraphFindings = (files, sources) => {
  const graph = dependencyGraph(files, sources);
  return {
    oversized: files.flatMap((file) => oversizedFunctions(file, sources.get(file))),
    unsafeEscapes: files.flatMap((file) => unsafeTypeEscapes(file, sources.get(file))),
    cycles: dependencyCycles(graph),
    directionViolations: dependencyDirectionViolations(graph),
    undeclaredDependencies: undeclaredWorkspaceDependencies(files, sources),
    retiredOwnerPaths: retiredOwnerPathViolations(files, sources),
  };
};

const collectArchitectureFindings = () => {
  const files = sourceRoots.flatMap(sourceFiles);
  const namedFiles = ownerWorkspaces.flatMap(ownerCodeFiles);
  const sources = new Map(files.map((file) => [file, fs.readFileSync(file, 'utf8')]));
  const fileStats = files.map((file) => ({
    file: relativePath(file),
    lines: lineCount(sources.get(file)),
  }));
  return {
    ...collectLayoutFindings(fileStats, namedFiles),
    ...collectSourceAndGraphFindings(files, sources),
  };
};

const printFindings = (items, format) => {
  for (const item of items) console.error(format(item));
};

const reportArchitectureFindings = (findings) => {
  printFindings(
    findings.oversizedFiles,
    (f) => `architecture: file ${f.file} has ${f.lines} lines (max ${maxFileLines})`,
  );
  printFindings(
    findings.oversizedFileStems,
    (f) =>
      `architecture: source filename ${f.file} has a ${f.length}-character stem (max ${f.maximumLength}); move repeated owner context into a directory and shorten the filename`,
  );
  printFindings(findings.contractLayoutRegressions, (f) => `architecture: ${f.reason}: ${f.file}`);
  printFindings(findings.testLayoutRegressions, (f) => `architecture: ${f.reason}: ${f.file}`);
  printFindings(
    findings.testFileLineRegressions,
    (f) => `architecture: test ${f.file} has ${f.lines} lines (max ${f.maximumLines})`,
  );
  printFindings(
    findings.sourceSizeRegressions,
    (f) => `architecture: ${f.reason}: ${f.file} has ${f.lines} lines (allowed ${f.allowed})`,
  );
  printFindings(
    findings.sourceSizeHistoryRegressions,
    (f) =>
      `architecture: ${f.reason}: ${f.file} has ${f.lines} baseline lines (historical max ${f.allowed})`,
  );
  printFindings(
    findings.oversized,
    (f) =>
      `architecture: function ${f.file}:${f.start} ${f.name} has ${f.lines} lines (max ${maxFunctionLines})`,
  );
  printFindings(findings.unsafeEscapes, (f) => `architecture: ${f.kind} ${f.file}:${f.line}`);
  printFindings(
    findings.cycles,
    (c) => `architecture: dependency cycle ${c.map(relativePath).join(' -> ')}`,
  );
  printFindings(
    findings.directionViolations,
    (v) => `architecture: forbidden dependency ${v.source} -> ${v.target}`,
  );
  printFindings(
    findings.undeclaredDependencies,
    (f) => `architecture: ${f.owner} imports undeclared workspace ${f.target} in ${f.file}`,
  );
  printFindings(
    findings.retiredOwnerPaths,
    (f) => `architecture: retired design owner path remains in ${f.file}`,
  );
};

const main = () => {
  const findings = collectArchitectureFindings();
  if (Object.values(findings).every((items) => items.length === 0)) {
    console.log(
      `ashfox architecture gate ok: files <= ${maxFileLines}, ` +
        `file stems <= ${maxFileStemLength}, ` +
        `tests <= ${maxTestFileLines} lines, owner contracts/tests canonical, ` +
        `>${sourceSizeRatchetLines}-line files within baseline, ` +
        `functions <= ${maxFunctionLines}, unsafe type escapes 0, cycles 0, ` +
        'layer direction, retired-owner paths, and workspace ' +
        'manifests valid',
    );
    return;
  }
  reportArchitectureFindings(findings);
  process.exitCode = 1;
};

if (require.main === module) main();

module.exports = {
  dependencyCycles,
  dependencyDirectionViolations,
  dependencyGraph,
  sourceSizeHistoryViolations,
  sourceSizeRatchetViolations,
};
