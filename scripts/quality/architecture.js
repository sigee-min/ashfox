/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');
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
      const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
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

const main = () => {
  const files = sourceRoots.flatMap(sourceFiles);
  const namedFiles = ownerWorkspaces.flatMap(ownerCodeFiles);
  const sources = new Map(files.map((file) => [file, fs.readFileSync(file, 'utf8')]));
  const fileStats = files.map((file) => ({
    file: relativePath(file),
    lines: lineCount(sources.get(file)),
  }));
  const oversizedFiles = fileStats.filter(({ lines }) => lines > maxFileLines);
  const oversizedFileStems = codeFileStemViolations(
    namedFiles.map(relativePath),
    maxFileStemLength,
  );
  const contractLayoutRegressions = ownerContractViolations(
    namedFiles.map(relativePath),
    qualityPolicy.ownerLayout.contractFile,
  );
  const testLayoutRegressions = testLayoutViolations(
    namedFiles.map(relativePath),
    qualityPolicy.ownerLayout,
  );
  const testFileLineRegressions = testFileLineViolations(
    namedFiles.map((file) => ({
      file: relativePath(file),
      lines: lineCount(fs.readFileSync(file, 'utf8')),
    })),
    maxTestFileLines,
  );
  const sourceSizeBaseline = JSON.parse(fs.readFileSync(sourceSizeBaselinePath, 'utf8'));
  const sourceSizeRegressions = sourceSizeRatchetViolations(
    fileStats,
    sourceSizeBaseline,
    sourceSizeRatchetLines,
  );
  const sourceSizeHistoryRegressions = sourceSizeHistoryViolations(
    sourceSizeBaseline,
    readHistoricalSourceSizeBaselines({
      repoRoot,
      baselinePath: sourceSizeBaselinePath,
      currentBaseline: sourceSizeBaseline,
    }),
    sourceSizeRatchetLines,
  );
  const oversized = files.flatMap((file) => oversizedFunctions(file, sources.get(file)));
  const unsafeEscapes = files.flatMap((file) => unsafeTypeEscapes(file, sources.get(file)));
  const graph = dependencyGraph(files, sources);
  const cycles = dependencyCycles(graph);
  const directionViolations = dependencyDirectionViolations(graph);
  const undeclaredDependencies = undeclaredWorkspaceDependencies(files, sources);
  const retiredOwnerPaths = retiredOwnerPathViolations(files, sources);
  if (
    oversizedFiles.length === 0 &&
    oversizedFileStems.length === 0 &&
    contractLayoutRegressions.length === 0 &&
    testLayoutRegressions.length === 0 &&
    testFileLineRegressions.length === 0 &&
    sourceSizeRegressions.length === 0 &&
    sourceSizeHistoryRegressions.length === 0 &&
    oversized.length === 0 &&
    unsafeEscapes.length === 0 &&
    cycles.length === 0 &&
    directionViolations.length === 0 &&
    undeclaredDependencies.length === 0 &&
    retiredOwnerPaths.length === 0
  ) {
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
  for (const finding of oversizedFiles) {
    console.error(
      `architecture: file ${finding.file} has ${finding.lines} lines ` + `(max ${maxFileLines})`,
    );
  }
  for (const finding of oversizedFileStems) {
    console.error(
      `architecture: source filename ${finding.file} has a ` +
        `${finding.length}-character stem (max ${finding.maximumLength}); ` +
        'move repeated owner context into a directory and shorten the filename',
    );
  }
  for (const finding of contractLayoutRegressions) {
    console.error(`architecture: ${finding.reason}: ${finding.file}`);
  }
  for (const finding of testLayoutRegressions) {
    console.error(`architecture: ${finding.reason}: ${finding.file}`);
  }
  for (const finding of testFileLineRegressions) {
    console.error(
      `architecture: test ${finding.file} has ${finding.lines} lines ` +
        `(max ${finding.maximumLines})`,
    );
  }
  for (const finding of sourceSizeRegressions) {
    console.error(
      `architecture: ${finding.reason}: ${finding.file} has ` +
        `${finding.lines} lines (allowed ${finding.allowed})`,
    );
  }
  for (const finding of sourceSizeHistoryRegressions) {
    console.error(
      `architecture: ${finding.reason}: ${finding.file} has ` +
        `${finding.lines} baseline lines (historical max ${finding.allowed})`,
    );
  }
  for (const finding of oversized) {
    console.error(
      `architecture: function ${finding.file}:${finding.start} ` +
        `${finding.name} has ${finding.lines} lines ` +
        `(max ${maxFunctionLines})`,
    );
  }
  for (const finding of unsafeEscapes) {
    console.error(`architecture: ${finding.kind} ${finding.file}:${finding.line}`);
  }
  for (const cycle of cycles) {
    console.error('architecture: dependency cycle ' + cycle.map(relativePath).join(' -> '));
  }
  for (const violation of directionViolations) {
    console.error(`architecture: forbidden dependency ${violation.source} -> ` + violation.target);
  }
  for (const finding of undeclaredDependencies) {
    console.error(
      `architecture: ${finding.owner} imports undeclared workspace ` +
        `${finding.target} in ${finding.file}`,
    );
  }
  for (const finding of retiredOwnerPaths) {
    console.error(`architecture: retired design owner path remains in ${finding.file}`);
  }
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
