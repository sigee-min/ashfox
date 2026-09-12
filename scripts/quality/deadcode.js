/* eslint-disable no-console */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const {
  dependencyGraph,
  reachableFiles,
  sourceFiles
} = require('./moduleGraph');

const repoRoot = path.resolve(__dirname, '..', '..');

const compatibilityExports = Object.freeze([]);

const normalizePath = (value) =>
  value.replace(/\\/g, '/').replace(/^\.\//, '');

const compilerConfig = (name = 'tsconfig.json') => {
  const configPath = path.join(repoRoot, name);
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error) {
    throw new Error(ts.flattenDiagnosticMessageText(
      read.error.messageText,
      '\n'
    ));
  }
  return ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    repoRoot
  );
};

const moduleExportNames = (config) => {
  const program = ts.createProgram(config.fileNames, config.options);
  const checker = program.getTypeChecker();
  const exportsByFile = new Map();
  for (const source of program.getSourceFiles()) {
    const symbol = checker.getSymbolAtLocation(source);
    if (!symbol) continue;
    exportsByFile.set(
      normalizePath(path.relative(repoRoot, source.fileName)),
      new Set(checker.getExportsOfModule(symbol).map((entry) => entry.name))
    );
  }
  return exportsByFile;
};

const unreachableModules = ({ root, entries, options }) => {
  const files = sourceFiles(root);
  const sources = new Map(files.map((file) => [
    file,
    fs.readFileSync(file, 'utf8')
  ]));
  const graph = dependencyGraph(files, sources, options);
  const reached = reachableFiles(
    graph,
    entries.map((entry) => path.join(root, entry))
  );
  return files.filter((file) => !reached.has(file));
};

const allFiles = (root) => {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const value = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(value);
      else files.push(value);
    }
  };
  visit(root);
  return files;
};

const exportTargets = (value) => {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap(exportTargets);
};

const targetPattern = (target) => new RegExp(
  '^' + target
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.+') + '$'
);

const packageExportEntries = (packageRoot) => {
  const manifestPath = path.join(packageRoot, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const targets = exportTargets(manifest.exports);
  const packageFiles = allFiles(packageRoot);
  const entries = new Set();
  for (const target of targets) {
    const normalized = normalizePath(target);
    if (!normalized.includes('*')) {
      const file = path.resolve(packageRoot, normalized);
      if (!fs.existsSync(file)) {
        throw new Error(`package export target does not exist: ${target}`);
      }
      entries.add(normalizePath(path.relative(repoRoot, file)));
      continue;
    }
    const pattern = targetPattern(normalized);
    const matches = packageFiles.filter((file) => pattern.test(
      normalizePath(path.relative(packageRoot, file))
    ));
    if (matches.length === 0) {
      throw new Error(`package export pattern has no targets: ${target}`);
    }
    for (const file of matches) {
      entries.add(normalizePath(path.relative(repoRoot, file)));
    }
  }
  return entries;
};

const workspacePackageRoots = (root) => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(root, 'package.json'),
    'utf8'
  ));
  return manifest.workspaces
    .map((workspace) => path.join(root, workspace))
    .filter((workspace) => {
      const packagePath = path.join(workspace, 'package.json');
      if (!fs.existsSync(packagePath)) return false;
      const value = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      return value.exports !== undefined;
    });
};

const publicEntryFiles = (root) => new Set(
  workspacePackageRoots(root).flatMap((packageRoot) => [
    ...packageExportEntries(packageRoot)
  ])
);

const publicExportGraph = (config, entryFiles, baseRoot = repoRoot) => {
  const program = ts.createProgram(config.fileNames, config.options);
  const checker = program.getTypeChecker();
  const publicExports = new Set();
  const targetOf = (symbol) => (symbol.flags & ts.SymbolFlags.Alias) === 0
    ? symbol
    : checker.getAliasedSymbol(symbol);
  const publicTargets = new Set();
  for (const entry of entryFiles) {
    const source = program.getSourceFile(path.resolve(baseRoot, entry));
    if (!source) {
      if (!/\.tsx?$/.test(entry)) continue;
      throw new Error(`public export entry is not compiled: ${entry}`);
    }
    const module = checker.getSymbolAtLocation(source);
    if (!module) continue;
    for (const symbol of checker.getExportsOfModule(module)) {
      publicTargets.add(targetOf(symbol));
    }
  }
  for (const source of program.getSourceFiles()) {
    const module = checker.getSymbolAtLocation(source);
    if (!module) continue;
    for (const symbol of checker.getExportsOfModule(module)) {
      if (!publicTargets.has(targetOf(symbol))) continue;
      publicExports.add(exportKey({
        file: normalizePath(path.relative(baseRoot, source.fileName)),
        symbol: symbol.name
      }));
    }
  }
  return publicExports;
};

const parseTsPrune = (output) => output
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const match = /^(.*):(\d+) - (.*?)( \(used in module\))?$/.exec(line);
    if (!match) throw new Error(`unrecognized ts-prune output: ${line}`);
    return {
      file: normalizePath(match[1]),
      line: Number(match[2]),
      symbol: match[3],
      usedInModule: match[4] !== undefined,
      source: line
    };
  });

const exportKey = ({ file, symbol }) => `${file}:${symbol}`;

const inspectUnusedExports = ({
  output,
  publicExports,
  allowances = [],
  declaredExports
}) => {
  const isDeclared = (entry) =>
    declaredExports === undefined ||
    declaredExports.get(entry.file)?.has(entry.symbol) === true;
  const unused = parseTsPrune(output).filter((entry) =>
    !entry.usedInModule && isDeclared(entry)
  );
  const unusedKeys = new Set(unused.map(exportKey));
  const allowedKeys = new Set(allowances.map(exportKey));
  return {
    findings: unused.filter((entry) =>
      !publicExports.has(exportKey(entry)) && !allowedKeys.has(exportKey(entry))
    ),
    staleAllowances: allowances.filter((entry) => declaredExports === undefined
      ? !unusedKeys.has(exportKey(entry))
      : !isDeclared(entry)
    )
  };
};

const runTsPrune = () => {
  const npmExecPath = process.env.npm_execpath;
  const cmd = npmExecPath
    ? process.execPath
    : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const args = npmExecPath
    ? [npmExecPath, 'exec', '--', 'ts-prune', '-p', 'tsconfig.deadcode.json']
    : ['exec', '--', 'ts-prune', '-p', 'tsconfig.deadcode.json'];
  const run = spawnSync(cmd, args, { encoding: 'utf8' });
  if (run.status !== 0) {
    const error = new Error('deadcode gate failed to run ts-prune');
    error.status = run.status ?? 1;
    error.stderr = run.stderr;
    throw error;
  }
  return run.stdout || '';
};

const reachabilityScopes = (options) => {
  const contractsRoot = path.join(repoRoot, 'packages/blockbench-contracts/src');
  const contractsEntries = [...packageExportEntries(
    path.dirname(contractsRoot)
  )]
    .filter((entry) => entry.startsWith('packages/blockbench-contracts/src/'))
    .map((entry) => entry.replace('packages/blockbench-contracts/src/', ''));
  return [
    ...[
      ['cli', 'apps/cli/src', ['main.ts', 'worker.ts', 'observe/worker.ts']],
      ['asset-build', 'packages/asset-build/src', ['index.ts']],
      ['audio-core', 'packages/audio-core/src', ['index.ts']],
      ['render-core', 'packages/render-core/src', ['index.ts', 'observation/browser.ts', 'gifenc.d.ts', ...[...packageExportEntries(path.join(repoRoot, 'packages/render-core'))].map(file => file.replace('packages/render-core/src/', ''))]]
    ].map(([label, directory, entries]) => ({ label, root: path.join(repoRoot, directory), entries, options })),
    {
      label: 'engine',
      root: path.join(repoRoot, 'packages/engine-core/src'),
      entries: ['index.ts'],
      options
    },
    {
      label: 'runtime',
      root: path.join(repoRoot, 'packages/blockbench-runtime/src'),
      entries: ['logging.ts', 'plugin.ts', 'server.ts', 'sidecar/index.ts'],
      options
    },
    {
      label: 'contracts',
      root: contractsRoot,
      entries: contractsEntries,
      options
    },

  ];
};

const checkedSourcePrefixes = Object.freeze([
  'apps/cli/src/',
  'packages/asset-build/src/',
  'packages/audio-core/src/',
  'packages/render-core/src/',
  'apps/blockbench-mcp-sidecar/src/',
  'apps/blockbench-plugin/src/',
  'packages/blockbench-contracts/src/',
  'packages/blockbench-runtime/src/',
  'packages/engine-core/src/',
  'packages/internal-contracts/src/'
]);

const isCheckedSource = (file) => checkedSourcePrefixes.some(
  (prefix) => file.startsWith(prefix)
);

const main = () => {
  let output;
  try {
    output = runTsPrune();
  } catch (error) {
    console.error(error.message);
    if (error.stderr) process.stderr.write(error.stderr);
    process.exitCode = error.status ?? 1;
    return;
  }
  const deadcodeConfig = compilerConfig('tsconfig.deadcode.json');
  const publicEntries = publicEntryFiles(repoRoot);
  const report = inspectUnusedExports({
    output,
    publicExports: publicExportGraph(deadcodeConfig, publicEntries),
    allowances: compatibilityExports,
    declaredExports: moduleExportNames(deadcodeConfig)
  });
  const findings = report.findings.filter((entry) =>
    isCheckedSource(entry.file)
  );
  const unreachable = reachabilityScopes(
    compilerConfig().options
  ).flatMap((scope) =>
    unreachableModules(scope).map((file) => ({ ...scope, file }))
  );
  for (const entry of unreachable) {
    console.error(
      `deadcode: ${entry.label} module is unreachable: ` +
      normalizePath(path.relative(repoRoot, entry.file))
    );
  }
  if (findings.length > 0) {
    console.error('ashfox deadcode gate failed (unused internal exports):');
    for (const finding of findings) console.error(`- ${finding.source}`);
  }
  if (report.staleAllowances.length > 0) {
    console.error('ashfox deadcode gate failed (stale compatibility exports):');
    for (const allowance of report.staleAllowances) {
      console.error(`- ${allowance.file} - ${allowance.symbol}`);
    }
  }
  if (
    unreachable.length > 0 ||
    findings.length > 0 ||
    report.staleAllowances.length > 0
  ) {
    process.exitCode = 1;
    return;
  }
  console.log('ashfox deadcode gate ok');
};

if (require.main === module) main();

module.exports = {
  inspectUnusedExports,
  moduleExportNames,
  packageExportEntries,
  parseTsPrune,
  publicExportGraph,
  unreachableModules
};
