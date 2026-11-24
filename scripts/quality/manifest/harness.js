'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');
const { DevelopmentManifestError, validateDevelopmentManifest } = require('./index');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const manifestPath = path.join(repoRoot, 'config', 'development-manifest.json');
const schemaPath = path.join(repoRoot, 'config', 'development-manifest.schema.json');
const source = fs.readFileSync(manifestPath, 'utf8');
const rawManifest = JSON.parse(source);
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const schemaValidator = new Ajv2020({
  allErrors: true,
  strict: true,
}).compile(schema);

const copyManifest = () => structuredClone(rawManifest);

const expectInvalid = (value, location) =>
  assert.throws(
    () => validateDevelopmentManifest(value, repoRoot),
    (error) =>
      error instanceof DevelopmentManifestError &&
      error.code === 'INVALID_DEVELOPMENT_MANIFEST' &&
      error.location === location,
  );

const expectSchemaInvalid = (value, label) =>
  assert.equal(
    schemaValidator(value),
    false,
    `${label} must be rejected by the published JSON Schema`,
  );

const exactPrefixValues = (definition) => definition.prefixItems.map((item) => item.const);

const assertClosedSchemaObjects = (node, location = '$') => {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return;
  if (node.type === 'object') {
    assert.equal(node.additionalProperties, false, `${location} must reject unknown properties`);
    assert.deepEqual(
      node.required,
      Object.keys(node.properties),
      `${location} required keys must use canonical property order`,
    );
  }
  for (const [key, value] of Object.entries(node)) {
    assertClosedSchemaObjects(value, `${location}.${key}`);
  }
};

module.exports = {
  assertClosedSchemaObjects,
  copyManifest,
  exactPrefixValues,
  expectInvalid,
  expectSchemaInvalid,
  rawManifest,
  repoRoot,
  schema,
  schemaValidator,
  source,
};
