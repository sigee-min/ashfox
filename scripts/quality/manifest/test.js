'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  DevelopmentManifestError,
  DEVELOPMENT_MANIFEST_SCHEMA_VERSION,
  parseDevelopmentManifest,
  readDevelopmentManifest
} = require('./index');
const {
  assertClosedSchemaObjects,
  copyManifest,
  exactPrefixValues,
  expectInvalid,
  expectSchemaInvalid,
  rawManifest,
  repoRoot,
  schema,
  schemaValidator,
  source
} = require('./harness');
const rootPackage = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')
);
const continuousIntegration = fs.readFileSync(
  path.join(repoRoot, '.github/workflows/ci.yml'),
  'utf8'
);

const manifest = readDevelopmentManifest(repoRoot);
assert.equal(
  schemaValidator(rawManifest),
  true,
  `canonical manifest must satisfy its JSON Schema: ${JSON.stringify(
    schemaValidator.errors
  )}`
);
assert.equal(manifest.schemaVersion, DEVELOPMENT_MANIFEST_SCHEMA_VERSION);
assert.equal(
  manifest.productExperience.interactionModel,
  'ai-authored-ai-compiled-human-observed'
);
assert.equal(manifest.productExperience.canonicalAuthority,
  'native-ashfox-source');
assert.deepEqual(manifest.productExperience.projectFile, {
  extension: '.ashfoxworkspace',
  mediaType: 'application/vnd.ashfox.workspace+json',
  encoding: 'utf-8',
  bom: 'forbidden',
  authority: 'optional-repository-configuration',
  loadMode: 'read-validate-build-atomic',
  compiledState: 'derived-files-only'
});
assert.equal(manifest.productExperience.agentDecision.compilationAuthority, 'agent');
assert.equal(manifest.productExperience.agentDecision.confirmationRequired, false);
assert.equal(manifest.productExperience.agentCapabilities.includes(
  'apply-workspace-change-set'), true);
assert.equal(manifest.productExperience.deliveryAuthority, 'human');
assert.deepEqual(manifest.versioning.assetWorkspace, {
  version: 2,
  sourceGrammar: 'ashfox-model 1',
  container: 'ashfox-workspace:2',
  compatibility: 'exact-current-contract',
  authority: 'packages/engine-core/src/project/directory/contract.ts',
  compiler: 'packages/engine-core/src/compiler/directory/compile.ts',
  releaseState: 'unreleased',
  replacementPolicy: 'apply-complete-change-set-atomically',
  legacyAliases: 'forbidden'
});
assert.equal(manifest.quality.maxSourceFileLines, 600);
assert.equal(manifest.quality.maxCodeFileStemLength, 20);
assert.equal(manifest.quality.newSourceFileRatchetLines, 500);
assert.equal(manifest.quality.maxFunctionLines, 200);
assert.deepEqual(manifest.quality.ownerLayout, {
  contractFile: 'contract',
  testFileSuffix: '.test',
  testFileExtension: '.ts',
  testFileStem: 'lower-word',
  maxTestFileStemLength: 18,
  maxTestFileLines: 500,
  testOwnership: 'owner-directory-required',
  testDiscovery: 'recursive-stable-nonempty',
  testOwners: rawManifest.quality.ownerLayout.testOwners
});
assert.deepEqual(manifest.architecture.workspaceSourceScopes, ['apps', 'packages']);
assert.equal(manifest.architecture.forbiddenDependencies.length, 10);

assert.ok(Object.isFrozen(manifest));
assert.ok(Object.isFrozen(manifest.productExperience.projectFile));
assert.ok(Object.isFrozen(manifest.productExperience.humanCapabilities));
assert.ok(Object.isFrozen(manifest.engineering.principles));
assert.ok(Object.isFrozen(manifest.engineering.principles[0].enforcedBy));
assert.ok(Object.isFrozen(manifest.workflow.commits.types));
assert.ok(Object.isFrozen(manifest.versioning.product.synchronizedFiles));
assert.ok(Object.isFrozen(manifest.versioning.assetWorkspace));
assert.ok(Object.isFrozen(manifest.quality.forbiddenSourcePatterns));
assert.ok(Object.isFrozen(manifest.quality.ownerLayout));
assert.ok(Object.isFrozen(manifest.quality.ownerLayout.testOwners));
assert.ok(Object.isFrozen(manifest.quality.ownerLayout.testOwners[0].roots));
assert.ok(Object.isFrozen(manifest.quality.forbiddenSourcePatterns[0].scope));
assert.ok(Object.isFrozen(manifest.architecture.workspacePolicy.required));
assert.ok(Object.isFrozen(manifest.architecture.packageDependencyPolicies));
assert.ok(Object.isFrozen(manifest.architecture.sourceImportBoundaries));
assert.ok(Object.isFrozen(manifest.architecture.forbiddenDependencies));
assert.ok(Object.isFrozen(manifest.architecture.forbiddenDependencies[0].targets));
assert.throws(() => {
  manifest.architecture.workspaceSourceScopes.push('other');
}, TypeError);

assert.equal(
  source,
  `${JSON.stringify(rawManifest, null, 2)}\n`,
  'root manifest stays canonically formatted for stable diffs'
);
assert.deepEqual(
  parseDevelopmentManifest(source, repoRoot),
  manifest,
  'parsing the same canonical source is deterministic'
);

assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
assert.equal(schema.properties.schemaVersion.const, DEVELOPMENT_MANIFEST_SCHEMA_VERSION);
assert.equal(
  schema.properties.productExperience.$ref,
  '#/$defs/productExperience'
);
assert.deepEqual(
  exactPrefixValues(schema.$defs.humanCapabilities),
  rawManifest.productExperience.humanCapabilities
);
assert.deepEqual(
  exactPrefixValues(schema.$defs.agentCapabilities),
  rawManifest.productExperience.agentCapabilities
);
assert.deepEqual(
  exactPrefixValues(schema.$defs.forbiddenHumanAuthoring),
  rawManifest.productExperience.forbiddenHumanAuthoring
);
assert.deepEqual(
  exactPrefixValues(
    schema.$defs.agentDecision.properties.requiredEvidence
  ),
  rawManifest.productExperience.agentDecision.requiredEvidence
);
assert.deepEqual(
  exactPrefixValues(schema.$defs.engineeringTesting.properties.statefulPaths),
  rawManifest.engineering.testing.statefulPaths
);
assert.deepEqual(
  schema.$defs.forbiddenSourcePattern.properties.id.enum,
  rawManifest.quality.forbiddenSourcePatterns.map((policy) => policy.id)
);
assert.equal(schema.$defs.engineering.properties.exceptions.maxItems, 0);
assert.equal(schema.$defs.engineering.properties.exceptions.items, false);
assert.equal(schema.$defs.engineeringException, undefined);
assertClosedSchemaObjects(schema);
assert.equal(
  rootPackage.scripts['quality:manifest'],
  'node scripts/quality/manifest/test.js && ' +
    'node scripts/quality/manifest/index.js'
);
assert.match(
  rootPackage.scripts['quality:check'],
  /(?:^|&&\s*)npm run quality:manifest(?:\s*&&|$)/,
  'quality:check must execute the manifest hard gate'
);
assert.match(
  rootPackage.scripts['quality:check'],
  /(?:^|&&\s*)npm run test:discovery(?:\s*&&|$)/,
  'quality:check must execute the stable recursive discovery contract'
);
assert.match(
  rootPackage.scripts['quality:check'],
  /(?:^|&&\s*)npm run typecheck:tests(?:\s*&&|$)/,
  'quality:check must typecheck every test contract in strict mode'
);
assert.match(
  rootPackage.scripts['quality:check'],
  /(?:^|&&\s*)npm run quality:commits(?:\s*&&|$)/,
  'quality:check must enforce manifest commit conventions'
);
assert.equal(
  rootPackage.scripts['release:validate'],
  'node scripts/release/validate.test.js && node scripts/release/publish.test.js && node scripts/release/validate.js'
);
assert.match(
  continuousIntegration,
  /run:\s*npm run quality:check/,
  'CI must inherit the manifest gate through quality:check'
);

const legacyVersion = copyManifest();
delete legacyVersion.schemaVersion;
legacyVersion.version = 1;
expectInvalid(legacyVersion, '$');

const unknownProductKey = copyManifest();
unknownProductKey.productExperience.rawEditor = true;
expectInvalid(unknownProductKey, 'productExperience');

const changedInteractionModel = copyManifest();
changedInteractionModel.productExperience.interactionModel = 'human-authored';
expectInvalid(changedInteractionModel, 'productExperience.interactionModel');

const archivedProjectFile = copyManifest();
archivedProjectFile.productExperience.projectFile.authority =
  'compiled-project-archive';
expectInvalid(
  archivedProjectFile,
  'productExperience.projectFile.authority'
);

const binaryProjectFile = copyManifest();
binaryProjectFile.productExperience.projectFile.mediaType =
  'application/zip';
expectInvalid(
  binaryProjectFile,
  'productExperience.projectFile.mediaType'
);

const reorderedHumanCapabilities = copyManifest();
reorderedHumanCapabilities.productExperience.humanCapabilities.reverse();
expectInvalid(
  reorderedHumanCapabilities,
  'productExperience.humanCapabilities'
);

const missingReviewEvidence = copyManifest();
missingReviewEvidence.productExperience.agentDecision.requiredEvidence.pop();
expectInvalid(
  missingReviewEvidence,
  'productExperience.agentDecision.requiredEvidence'
);

const humanConfirmationRequired = copyManifest();
humanConfirmationRequired.productExperience.agentDecision
  .confirmationRequired = true;
expectInvalid(
  humanConfirmationRequired,
  'productExperience.agentDecision.confirmationRequired'
);

const unsortedPrinciples = copyManifest();
unsortedPrinciples.engineering.principles.reverse();
expectInvalid(unsortedPrinciples, 'engineering.principles[0].id');

const unknownEngineeringEnforcer = copyManifest();
unknownEngineeringEnforcer.engineering.principles[0].enforcedBy = ['unknown'];
expectInvalid(
  unknownEngineeringEnforcer,
  'engineering.principles[0].enforcedBy[0]'
);

const forbiddenException = copyManifest();
forbiddenException.engineering.exceptions.push({
  ruleId: 'single-authority',
  path: 'package.json',
  reason: 'Temporary compatibility bridge.',
  owner: 'engine',
  expiresOn: '2026-12-31'
});
expectInvalid(forbiddenException, 'engineering.exceptions');

const unknownWorkflowKey = copyManifest();
unknownWorkflowKey.workflow.commits.allowMergeCommits = true;
expectInvalid(unknownWorkflowKey, 'workflow.commits');

const mutableVersionOwner = copyManifest();
mutableVersionOwner.versioning.product.changeOwner = 'feature-branch';
expectInvalid(mutableVersionOwner, 'versioning.product.changeOwner');

const unknownHandoffGate = copyManifest();
unknownHandoffGate.workflow.verification.beforeHandoff = ['npm run lint'];
expectInvalid(
  unknownHandoffGate,
  'workflow.verification.beforeHandoff'
);
expectSchemaInvalid(unknownHandoffGate, 'unknown handoff verification gate');

const unknownPullRequestGate = copyManifest();
unknownPullRequestGate.workflow.verification.beforePullRequest = [
  'npm run test'
];
expectInvalid(
  unknownPullRequestGate,
  'workflow.verification.beforePullRequest'
);
expectSchemaInvalid(
  unknownPullRequestGate,
  'unknown pull-request verification gate'
);

const unknownSynchronizedFile = copyManifest();
unknownSynchronizedFile.versioning.product.synchronizedFiles = [
  '.github/release-please/manifest.json',
  'packages/engine-core/package.json'
];
expectInvalid(
  unknownSynchronizedFile,
  'versioning.product.synchronizedFiles'
);
expectSchemaInvalid(
  unknownSynchronizedFile,
  'unknown synchronized version file'
);

const mutableAssetCompiler = copyManifest();
mutableAssetCompiler.versioning.assetWorkspace.compiler =
  'packages/engine-core/src/textures/textureRecipe/raster.ts';
expectInvalid(
  mutableAssetCompiler,
  'versioning.assetWorkspace.compiler'
);
expectSchemaInvalid(mutableAssetCompiler, 'unsupported asset compiler');

const deliveryMayMutate = copyManifest();
deliveryMayMutate.versioning.deliveryTargets.canonicalMutation = true;
expectInvalid(
  deliveryMayMutate,
  'versioning.deliveryTargets.canonicalMutation'
);

const excessiveFunctionLimit = copyManifest();
excessiveFunctionLimit.quality.maxFunctionLines = 501;
expectInvalid(excessiveFunctionLimit, 'quality.maxFunctionLines');

const invalidFileStemLimit = copyManifest();
invalidFileStemLimit.quality.maxCodeFileStemLength = 0;
expectInvalid(invalidFileStemLimit, 'quality.maxCodeFileStemLength');

const invalidTestStemLimit = copyManifest();
invalidTestStemLimit.quality.ownerLayout.maxTestFileStemLength = 0;
expectInvalid(
  invalidTestStemLimit,
  'quality.ownerLayout.maxTestFileStemLength'
);

const invalidTestFileLimit = copyManifest();
invalidTestFileLimit.quality.ownerLayout.maxTestFileLines = 0;
expectInvalid(
  invalidTestFileLimit,
  'quality.ownerLayout.maxTestFileLines'
);
expectSchemaInvalid(invalidTestFileLimit, 'non-positive test file limit');

const excessiveTestFileLimit = copyManifest();
excessiveTestFileLimit.quality.ownerLayout.maxTestFileLines = 601;
expectInvalid(
  excessiveTestFileLimit,
  'quality.ownerLayout.maxTestFileLines'
);

const invalidTestStemForm = copyManifest();
invalidTestStemForm.quality.ownerLayout.testFileStem = 'free-form';
expectInvalid(invalidTestStemForm, 'quality.ownerLayout.testFileStem');
expectSchemaInvalid(invalidTestStemForm, 'free-form test filename policy');

const invalidTestExtension = copyManifest();
invalidTestExtension.quality.ownerLayout.testFileExtension = '.tsx';
expectInvalid(invalidTestExtension, 'quality.ownerLayout.testFileExtension');
expectSchemaInvalid(invalidTestExtension, 'unsupported test file extension');

const unsortedTestOwners = copyManifest();
unsortedTestOwners.quality.ownerLayout.testOwners.reverse();
expectInvalid(unsortedTestOwners, 'quality.ownerLayout.testOwners');

const unsortedTestRoots = copyManifest();
unsortedTestRoots.quality.ownerLayout.testOwners[0].roots.reverse();
expectInvalid(
  unsortedTestRoots,
  'quality.ownerLayout.testOwners[0].roots'
);

const mutableTestOwnership = copyManifest();
mutableTestOwnership.quality.ownerLayout.testOwnership = 'recommended';
expectInvalid(mutableTestOwnership, 'quality.ownerLayout.testOwnership');

const ineffectiveRatchet = copyManifest();
ineffectiveRatchet.quality.newSourceFileRatchetLines = 600;
expectInvalid(ineffectiveRatchet, 'quality.newSourceFileRatchetLines');

const reorderedSourcePatterns = copyManifest();
reorderedSourcePatterns.quality.forbiddenSourcePatterns.reverse();
expectInvalid(reorderedSourcePatterns, 'quality.forbiddenSourcePatterns[0].id');

const unknownSourcePatternKey = copyManifest();
unknownSourcePatternKey.quality.forbiddenSourcePatterns[0].reason = 'unsafe';
expectInvalid(
  unknownSourcePatternKey,
  'quality.forbiddenSourcePatterns[0]'
);

const sourcePatternAllowanceOutsideScope = copyManifest();
const consolePolicy = sourcePatternAllowanceOutsideScope.quality
  .forbiddenSourcePatterns.find((policy) => policy.id === 'console-in-src');
consolePolicy.scope = ['apps/'];
expectInvalid(
  sourcePatternAllowanceOutsideScope,
  'quality.forbiddenSourcePatterns[5].allowedPaths[0]'
);

const unscannedSourcePatternScope = copyManifest();
unscannedSourcePatternScope.quality.forbiddenSourcePatterns[0].scope = [
  'docs/'
];
expectInvalid(
  unscannedSourcePatternScope,
  'quality.forbiddenSourcePatterns[0].scope[0]'
);

const uncoveredWorkspace = copyManifest();
uncoveredWorkspace.architecture.workspaceSourceScopes = ['apps'];
expectInvalid(
  uncoveredWorkspace,
  'architecture.workspaceSourceScopes'
);

const forbiddenCurrentWorkspace = copyManifest();
forbiddenCurrentWorkspace.architecture.workspacePolicy.forbidden = [
  'apps/site',
  'apps/worker',
  'packages/backend-core',
  'packages/backend-engine'
];
expectInvalid(
  forbiddenCurrentWorkspace,
  'architecture.workspacePolicy.forbidden'
);

const unknownWorkspacePolicyKey = copyManifest();
unknownWorkspacePolicyKey.architecture.workspacePolicy.optional = [];
expectInvalid(unknownWorkspacePolicyKey, 'architecture.workspacePolicy');

const unsortedTombstones = copyManifest();
unsortedTombstones.architecture.tombstones.reverse();
expectInvalid(unsortedTombstones, 'architecture.tombstones');

const duplicateDependencyPolicyValue = copyManifest();
duplicateDependencyPolicyValue.architecture.packageDependencyPolicies[0]
  .values = ['marked', 'marked'];
expectInvalid(
  duplicateDependencyPolicyValue,
  'architecture.packageDependencyPolicies[0].values'
);

const missingImportBoundarySource = copyManifest();
missingImportBoundarySource.architecture.sourceImportBoundaries[0].source =
  'apps/absent/';
expectInvalid(
  missingImportBoundarySource,
  'architecture.sourceImportBoundaries[0].source'
);

const unsortedRules = copyManifest();
unsortedRules.architecture.forbiddenDependencies.reverse();
expectInvalid(unsortedRules, 'architecture.forbiddenDependencies');

const duplicateTarget = copyManifest();
duplicateTarget.architecture.forbiddenDependencies[2].targets = [
  'packages/blockbench-runtime/src/plugin/',
  'packages/blockbench-runtime/src/plugin/'
];
expectInvalid(
  duplicateTarget,
  'architecture.forbiddenDependencies[2].targets'
);

const missingSourceDirectory = copyManifest();
missingSourceDirectory.architecture.forbiddenDependencies[0].source =
  'apps/web/src/absent/';
expectInvalid(
  missingSourceDirectory,
  'architecture.forbiddenDependencies[0].source'
);

const reorderedRoot = {
  schemaVersion: rawManifest.schemaVersion,
  $schema: rawManifest.$schema,
  productExperience: rawManifest.productExperience,
  engineering: rawManifest.engineering,
  workflow: rawManifest.workflow,
  versioning: rawManifest.versioning,
  quality: rawManifest.quality,
  architecture: rawManifest.architecture
};
expectInvalid(reorderedRoot, '$');

assert.throws(
  () => parseDevelopmentManifest(JSON.stringify(rawManifest), repoRoot),
  (error) =>
    error instanceof DevelopmentManifestError && error.location === '$'
);
assert.throws(
  () => parseDevelopmentManifest('{"schemaVersion":1,}', repoRoot),
  (error) =>
    error instanceof DevelopmentManifestError && error.location === '$'
);

console.log('development manifest contract ok');
