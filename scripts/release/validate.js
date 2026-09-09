/* eslint-disable no-console */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  readDevelopmentManifest
} = require('../quality/manifest');

const readText = (repoRoot, relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
const readJson = (repoRoot, relativePath) =>
  JSON.parse(readText(repoRoot, relativePath));

const isStrictSemVer = (value) => {
  if (typeof value !== 'string') return false;
  const match = value.match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/
  );
  if (!match) return false;
  for (const identifier of match.slice(1, 4)) {
    if (identifier.length > 1 && identifier.startsWith('0')) return false;
  }
  if (!match[4]) return true;
  return match[4].split('.').every((identifier) =>
    !/^\d+$/.test(identifier) ||
    identifier === '0' ||
    !identifier.startsWith('0')
  );
};

const readDeclaredVersion = (repoRoot, relativePath, sourceOfTruth) => {
  const text = readText(repoRoot, relativePath);
  if (relativePath.endsWith('.json')) {
    const value = JSON.parse(text);
    const version = sourceOfTruth ? value.version : value['.'] ?? value.version;
    return typeof version === 'string' ? version : '';
  }
  const match = text.match(
    /export const [A-Z][A-Z0-9_]*VERSION\s*=\s*'([^']+)'/
  );
  return match ? match[1] : '';
};

const versionPolicyFailures = (policy, entries) => {
  const failures = [];
  if (policy.scheme !== 'semver') {
    failures.push(`Unsupported product version scheme: ${policy.scheme}.`);
    return failures;
  }
  const source = entries.find((entry) => entry.path === policy.sourceOfTruth);
  if (!source || source.version.length === 0) {
    failures.push(`${policy.sourceOfTruth} version is missing or invalid.`);
  }
  for (const entry of entries) {
    if (entry.version.length === 0) {
      if (entry.path !== policy.sourceOfTruth) {
        failures.push(`${entry.path} version is missing or invalid.`);
      }
      continue;
    }
    if (!isStrictSemVer(entry.version)) {
      failures.push(
        `${entry.path} version must be strict SemVer ` +
        `(actual: ${entry.version}).`
      );
    }
    if (source && source.version.length > 0 &&
        entry.path !== policy.sourceOfTruth &&
        entry.version !== source.version) {
      failures.push(
        `Version mismatch: ${policy.sourceOfTruth}(${source.version}) != ` +
        `${entry.path}(${entry.version}).`
      );
    }
  }
  return failures;
};

const releaseValidationFailures = (
  repoRoot,
  developmentManifest = readDevelopmentManifest(repoRoot)
) => {
  const failures = [];
  const productPolicy = developmentManifest.versioning.product;
  const versionPaths = [
    productPolicy.sourceOfTruth,
    ...productPolicy.synchronizedFiles
  ];
  const entries = versionPaths.map((relativePath) => ({
    path: relativePath,
    version: readDeclaredVersion(
      repoRoot,
      relativePath,
      relativePath === productPolicy.sourceOfTruth
    )
  }));
  failures.push(...versionPolicyFailures(productPolicy, entries));

  const sourcePackage = readJson(repoRoot, productPolicy.sourceOfTruth);
  const packageName = typeof sourcePackage.name === 'string'
    ? sourcePackage.name
    : '';
  if (!packageName) {
    failures.push(`${productPolicy.sourceOfTruth} name is missing or invalid.`);
  }

  const releaseManifestPath = productPolicy.synchronizedFiles.find(
    (relativePath) => path.basename(relativePath) === 'manifest.json'
  );
  if (!releaseManifestPath) {
    failures.push('Product version policy must name a release manifest.');
    return failures;
  }
  const releaseConfigPath = path.posix.join(
    path.posix.dirname(releaseManifestPath),
    'config.json'
  );
  const releaseConfig = readJson(repoRoot, releaseConfigPath);
  const rootPackageConfig = releaseConfig?.packages?.['.'];
  if (!rootPackageConfig) {
    failures.push('release-please config must define packages["."].');
  } else {
    const releaseType = rootPackageConfig['release-type'];
    const configuredPackageName = rootPackageConfig['package-name'];
    const component = rootPackageConfig.component;
    const includeComponentInTag =
      rootPackageConfig['include-component-in-tag'];
    const preMajorPatchMode =
      rootPackageConfig['bump-patch-for-minor-pre-major'];
    const extraFiles = Array.isArray(rootPackageConfig['extra-files'])
      ? rootPackageConfig['extra-files']
      : [];
    if (releaseType !== 'node') {
      failures.push(
        `release-type must be "node" (actual: ${String(releaseType)}).`
      );
    }
    if (configuredPackageName !== packageName) {
      failures.push(
        `release-please package-name(${String(configuredPackageName)}) ` +
        `must match ${productPolicy.sourceOfTruth} name(${packageName}).`
      );
    }
    if (typeof component !== 'string' || component.trim().length === 0) {
      failures.push('release-please component must be a non-empty string.');
    }
    if (includeComponentInTag !== false) {
      failures.push(
        'release-please include-component-in-tag must be false to keep ' +
        'tags in vX.Y.Z format.'
      );
    }
    if (preMajorPatchMode !== true) {
      failures.push(
        'release-please bump-patch-for-minor-pre-major must be true for ' +
        'pre-1.0 patch-first releases.'
      );
    }
    const managedExtraFiles = productPolicy.synchronizedFiles.filter(
      (relativePath) => !relativePath.startsWith('.github/release-please/')
    );
    for (const relativePath of managedExtraFiles) {
      if (!extraFiles.includes(relativePath)) {
        failures.push(
          `release-please extra-files must include ${relativePath} to keep ` +
          'the product version synchronized.'
        );
      }
    }
  }

  const releaseWorkflow = readText(
    repoRoot,
    '.github/workflows/release-please.yml'
  );
  for (const script of ['artifacts.js', 'smoke.js', 'publish.js']) {
    if (!releaseWorkflow.includes(`node scripts/release/${script}`)) {
      failures.push(`Release workflow must run ${script}.`);
    }
  }
  if (releaseWorkflow.includes('overwrite_files: true')) {
    failures.push('Release workflow must not overwrite published assets.');
  }
  return failures;
};

const main = () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const developmentManifest = readDevelopmentManifest(repoRoot);
  const failures = releaseValidationFailures(repoRoot, developmentManifest);
  if (failures.length > 0) {
    console.error('ashfox release validation failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }
  const sourcePath = developmentManifest.versioning.product.sourceOfTruth;
  const source = readJson(repoRoot, sourcePath);
  console.log(
    `ashfox release validation ok (name=${source.name}, ` +
    `version=${source.version})`
  );
};

if (require.main === module) main();

module.exports = {
  isStrictSemVer,
  releaseValidationFailures,
  versionPolicyFailures
};
