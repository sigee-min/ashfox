'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { importSpecifiers, privateEngineImportViolations, scriptFiles } = require(
  './scriptArchitecture');

const repoRoot = path.resolve(__dirname, '..', '..');
assert.deepEqual(
  privateEngineImportViolations({ repoRoot }),
  [],
  'all script-side private engine access must use the public engine barrel'
);
assert.deepEqual(
  importSpecifiers("const value = require('./public'); import('./lazy');"),
  ['./public', './lazy']
);

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(),
  'ashfox-script-architecture-'));
try {
  const fixtureScripts = path.join(fixtureRoot, 'scripts');
  fs.mkdirSync(fixtureScripts, { recursive: true });
  const bad = path.join(fixtureScripts, 'bad.js');
  const privateModule = ['..', 'packages', 'engine-core', 'src',
    'compiler', 'program', 'design'].join('/');
  fs.writeFileSync(bad,
    `require('${privateModule}');\n`);
  assert.deepEqual(
    privateEngineImportViolations({
      repoRoot: fixtureRoot, files: [bad]
    }),
    [{
      file: 'scripts/bad.js',
      specifier: privateModule
    }],
    'a new script cannot import a private engine module'
  );
  const app = path.join(fixtureRoot, 'apps', 'study');
  fs.mkdirSync(path.join(app, 'dist'), { recursive: true });
  const appSource = path.join(app, 'engine.js');
  fs.writeFileSync(appSource, `require('${['..', '..', 'packages', 'engine-core', 'src', 'compiler', 'private'].join('/')}');`);
  fs.writeFileSync(path.join(app, 'dist', 'bundle.js'), 'generated');
  assert.ok(scriptFiles(fixtureRoot).includes(appSource));
  assert.ok(!scriptFiles(fixtureRoot).includes(path.join(app, 'dist', 'bundle.js')));
  const publicFile = path.join(fixtureScripts, 'public.js');
  const publicModule = ['..', 'packages', 'engine-core', 'src'].join('/');
  fs.writeFileSync(publicFile,
    `require('${publicModule}');\n`);
  assert.deepEqual(
    privateEngineImportViolations({
      repoRoot: fixtureRoot, files: [publicFile]
    }),
    [],
    'the public engine barrel remains a supported script dependency'
  );
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log('script architecture boundary tests ok');
