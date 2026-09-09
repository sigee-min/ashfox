'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  isStrictSemVer,
  releaseValidationFailures,
  versionPolicyFailures
} = require('./validate');
const {
  readDevelopmentManifest
} = require('../quality/manifest');

const repoRoot = path.resolve(__dirname, '..', '..');
const developmentManifest = readDevelopmentManifest(repoRoot);
const productPolicy = developmentManifest.versioning.product;

for (const value of [
  '0.0.0',
  '1.2.3',
  '1.2.3-alpha.1',
  '1.2.3-alpha.1+build.05'
]) {
  assert.equal(isStrictSemVer(value), true, `${value} must be valid SemVer`);
}
for (const value of [
  'v1.2.3',
  '1.2',
  '01.2.3',
  '1.02.3',
  '1.2.03',
  '1.2.3-01',
  'not-semver'
]) {
  assert.equal(isStrictSemVer(value), false, `${value} must be rejected`);
}

const equalButInvalid = [
  productPolicy.sourceOfTruth,
  ...productPolicy.synchronizedFiles
].map((entryPath) => ({ path: entryPath, version: 'not-semver' }));
const equalityOnlyFailures = versionPolicyFailures(
  productPolicy,
  equalButInvalid
);
assert.equal(
  equalityOnlyFailures.filter((failure) => failure.includes('strict SemVer'))
    .length,
  equalButInvalid.length,
  'matching invalid versions must all fail strict SemVer validation'
);
assert.equal(
  equalityOnlyFailures.some((failure) => failure.includes('Version mismatch')),
  false,
  'the fixture proves equality alone is not accepted as validity'
);

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-release-'));
const writeFixture = (relativePath, contents) => {
  const target = path.join(fixtureRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
};
try {
  writeFixture(
    productPolicy.sourceOfTruth,
    `${JSON.stringify({ name: 'ashfox', version: 'not-semver' }, null, 2)}\n`
  );
  writeFixture(
    '.github/release-please/manifest.json',
    `${JSON.stringify({ '.': 'not-semver' }, null, 2)}\n`
  );
  writeFixture(
    'packages/blockbench-runtime/src/config.ts',
    "export const PLUGIN_VERSION = 'not-semver';\n"
  );
  writeFixture(
    '.github/release-please/config.json',
    `${JSON.stringify({
      packages: {
        '.': {
          'release-type': 'node',
          'package-name': 'ashfox',
          component: 'ashfox',
          'include-component-in-tag': false,
          'bump-patch-for-minor-pre-major': true,
          'extra-files': [
            'packages/blockbench-runtime/src/config.ts'
          ]
        }
      }
    }, null, 2)}\n`
  );
  writeFixture(
    '.github/workflows/release-please.yml',
    [
      'node scripts/release/artifacts.js',
      'node scripts/release/smoke.js',
      'node scripts/release/publish.js',
      ''
    ].join('\n')
  );
  const validWorkflow = fs.readFileSync(path.join(fixtureRoot, '.github/workflows/release-please.yml'), 'utf8');
  writeFixture('.github/workflows/release-please.yml', validWorkflow + 'overwrite_files: true\n');
  assert.ok(releaseValidationFailures(fixtureRoot, developmentManifest)
    .some(failure => failure.includes('must not overwrite')));
  writeFixture('.github/workflows/release-please.yml', '');
  assert.equal(releaseValidationFailures(fixtureRoot, developmentManifest)
    .filter(failure => failure.includes('Release workflow must run')).length, 3);
  writeFixture('.github/workflows/release-please.yml', validWorkflow);
  const failures = releaseValidationFailures(
    fixtureRoot,
    developmentManifest
  );
  assert.equal(
    failures.filter((failure) => failure.includes('strict SemVer')).length,
    3
  );
  assert.equal(
    failures.some((failure) => failure.includes('Version mismatch')),
    false
  );
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log('ashfox release validation fixture tests ok');
