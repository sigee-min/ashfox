'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  DevelopmentManifestError,
  DEVELOPMENT_MANIFEST_FILENAME,
  DEVELOPMENT_MANIFEST_SCHEMA_FILENAME,
  DEVELOPMENT_MANIFEST_SCHEMA_REFERENCE,
  DEVELOPMENT_MANIFEST_SCHEMA_VERSION,
  fail,
  MANIFEST_KEYS,
} = require('./contract');
const { validateArchitecture } = require('./architecture');
const { validateQuality } = require('./quality');
const {
  validateEngineering,
  validateProductExperience,
  validateVersioning,
  validateWorkflow,
} = require('./policy');
const {
  assertClosedOrderedRecord,
  assertExactValue,
  assertExistingFile,
  readRootPackageWorkspaces,
} = require('./reader');
const { freezeManifest } = require('./snapshot');

const validateDevelopmentManifest = (value, repoRoot) => {
  const root = path.resolve(repoRoot);
  const manifest = assertClosedOrderedRecord(value, '$', MANIFEST_KEYS.root);
  assertExactValue(manifest.$schema, DEVELOPMENT_MANIFEST_SCHEMA_REFERENCE, '$schema');
  assertExactValue(manifest.schemaVersion, DEVELOPMENT_MANIFEST_SCHEMA_VERSION, 'schemaVersion');
  assertExistingFile(root, DEVELOPMENT_MANIFEST_SCHEMA_FILENAME, '$schema');
  validateProductExperience(manifest.productExperience);
  validateEngineering(manifest.engineering);
  validateWorkflow(manifest.workflow);
  validateVersioning(manifest.versioning, root);
  const workspaces = readRootPackageWorkspaces(root);
  validateArchitecture(manifest.architecture, root, workspaces);
  validateQuality(manifest.quality, root, manifest.architecture.workspaceSourceScopes);
  return freezeManifest(manifest);
};

const parseDevelopmentManifest = (source, repoRoot) => {
  if (typeof source !== 'string') fail('$', 'source must be text');
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    fail('$', 'must be valid JSON');
  }
  const canonicalSource = `${JSON.stringify(value, null, 2)}\n`;
  if (source !== canonicalSource) {
    fail('$', 'must use canonical two-space JSON formatting and key order');
  }
  return validateDevelopmentManifest(value, repoRoot);
};

const readDevelopmentManifest = (repoRoot) => {
  const root = path.resolve(repoRoot);
  const manifestPath = path.join(root, DEVELOPMENT_MANIFEST_FILENAME);
  let source;
  try {
    source = fs.readFileSync(manifestPath, 'utf8');
  } catch {
    fail('$', `${DEVELOPMENT_MANIFEST_FILENAME} is missing or unreadable`);
  }
  return parseDevelopmentManifest(source, root);
};

const main = () => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const manifest = readDevelopmentManifest(repoRoot);
  console.log(
    `development manifest v${manifest.schemaVersion} ok: ` +
      `${manifest.architecture.workspaceSourceScopes.length} workspace scopes, ` +
      `${manifest.architecture.forbiddenDependencies.length} dependency rules`,
  );
};

if (require.main === module) main();

module.exports = {
  DevelopmentManifestError,
  DEVELOPMENT_MANIFEST_FILENAME,
  DEVELOPMENT_MANIFEST_SCHEMA_FILENAME,
  DEVELOPMENT_MANIFEST_SCHEMA_VERSION,
  parseDevelopmentManifest,
  readDevelopmentManifest,
  validateDevelopmentManifest,
};
