const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ts = require('typescript');

const {
  inspectUnusedExports,
  packageExportEntries,
  publicExportGraph,
  unreachableModules,
} = require('./deadcode');

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-deadcode-'));
try {
  fs.mkdirSync(path.join(fixture, 'owner'));
  fs.writeFileSync(path.join(fixture, 'index.ts'), "export { value } from './owner/value';\n");
  fs.writeFileSync(path.join(fixture, 'owner/value.ts'), 'export const value = 1;\n');
  fs.writeFileSync(path.join(fixture, 'owner/dead.ts'), 'export const dead = 1;\n');
  assert.deepStrictEqual(
    unreachableModules({
      root: fixture,
      entries: ['index.ts'],
      options: {},
    }),
    [path.join(fixture, 'owner/dead.ts').replace(/\\/g, '/')],
  );
  fs.writeFileSync(
    path.join(fixture, 'index.ts'),
    "export { value } from './owner/value';\n" + "export { dead } from './owner/dead';\n",
  );
  assert.deepStrictEqual(
    unreachableModules({
      root: fixture,
      entries: ['index.ts'],
      options: {},
    }),
    [],
  );

  const publicExports = new Set(['fixture/src/index.ts:publicValue']);
  const report = inspectUnusedExports({
    output: [
      'fixture/src/index.ts:1 - publicValue',
      'fixture/src/internal.ts:1 - internalDead',
      'fixture/src/used.ts:1 - usedHelper (used in module)',
    ].join('\n'),
    publicExports,
  });
  assert.deepStrictEqual(
    report.findings.map((entry) => entry.symbol),
    ['internalDead'],
    'an unused internal export must fail while public and module-used exports pass',
  );
  assert.deepStrictEqual(report.staleAllowances, []);

  const exactAllowance = {
    file: 'fixture/src/internal.ts',
    symbol: 'internalDead',
  };
  assert.deepStrictEqual(
    inspectUnusedExports({
      output: 'fixture/src/internal.ts:1 - internalDead\n',
      publicExports,
      allowances: [exactAllowance],
    }),
    {
      findings: [],
      staleAllowances: [],
    },
  );
  assert.deepStrictEqual(
    inspectUnusedExports({
      output: 'fixture/src/internal.ts:1 - anotherExport\n',
      publicExports,
      allowances: [exactAllowance],
    }).staleAllowances,
    [exactAllowance],
  );

  const packageRoot = path.join(fixture, 'package');
  fs.mkdirSync(path.join(packageRoot, 'src/tools'), { recursive: true });
  fs.writeFileSync(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({
      exports: {
        '.': './src/index.ts',
        './tools/*': './src/tools/*.ts',
      },
    }),
  );
  fs.writeFileSync(path.join(packageRoot, 'src/index.ts'), 'export {};\n');
  fs.writeFileSync(path.join(packageRoot, 'src/tools/paint.ts'), 'export const paint = true;\n');
  const exported = [...packageExportEntries(packageRoot)];
  assert.equal(exported.length, 2);
  assert.ok(exported.some((entry) => entry.endsWith('/src/index.ts')));
  assert.ok(exported.some((entry) => entry.endsWith('/src/tools/paint.ts')));

  fs.writeFileSync(
    path.join(packageRoot, 'src/index.ts'),
    "export { publicValue } from './owner/value';\n",
  );
  fs.mkdirSync(path.join(packageRoot, 'src/owner'), { recursive: true });
  fs.writeFileSync(
    path.join(packageRoot, 'src/owner/value.ts'),
    'export const publicValue = 1;\nexport const internalDead = 2;\n',
  );
  const publicGraph = publicExportGraph(
    {
      fileNames: [
        path.join(packageRoot, 'src/index.ts'),
        path.join(packageRoot, 'src/owner/value.ts'),
      ],
      options: {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Node10,
        target: ts.ScriptTarget.ES2020,
      },
    },
    new Set(['src/index.ts']),
    packageRoot,
  );
  assert.ok(publicGraph.has('src/index.ts:publicValue'));
  assert.ok(publicGraph.has('src/owner/value.ts:publicValue'));
  assert.ok(!publicGraph.has('src/owner/value.ts:internalDead'));

  const webRoot = path.join(fixture, 'web');
  fs.mkdirSync(path.join(webRoot, 'types'), { recursive: true });
  fs.writeFileSync(path.join(webRoot, 'main.tsx'), "import './view';\n");
  fs.writeFileSync(path.join(webRoot, 'view.ts'), 'export {};\n');
  fs.writeFileSync(path.join(webRoot, 'dynamic.ts'), 'export {};\n');
  fs.writeFileSync(path.join(webRoot, 'types/ambient.d.ts'), "declare module 'asset';\n");
  fs.writeFileSync(path.join(webRoot, 'orphan.ts'), 'export {};\n');
  assert.deepStrictEqual(
    unreachableModules({
      root: webRoot,
      entries: ['main.tsx', 'dynamic.ts', 'types/ambient.d.ts'],
      options: {},
    }),
    [path.join(webRoot, 'orphan.ts').replace(/\\/g, '/')],
  );
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}

console.log('ashfox deadcode fixture tests ok');
