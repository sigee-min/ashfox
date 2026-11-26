'use strict';

const {
  AGENT_CAPABILITIES,
  AGENT_DECISION_EVIDENCE,
  COMMIT_TYPES,
  ENGINEERING_ENFORCERS,
  ENGINEERING_PRINCIPLE_IDS,
  fail,
  FORBIDDEN_HUMAN_AUTHORING,
  HUMAN_CAPABILITIES,
  MANIFEST_KEYS,
  STATEFUL_TEST_PATHS,
  SYNCHRONIZED_PRODUCT_VERSION_FILES,
} = require('./contract');
const {
  assertClosedOrderedRecord,
  assertExactTextArray,
  assertExactValue,
  assertExistingFile,
  assertSortedUniqueTextArray,
  isDenseContractArray,
  isNonEmptyContractText,
} = require('./reader');

const validateProjectFile = (value) => {
  const projectFile = assertClosedOrderedRecord(
    value,
    'productExperience.projectFile',
    MANIFEST_KEYS.projectFile,
  );
  const expected = {
    extension: '.ashfoxworkspace',
    mediaType: 'application/vnd.ashfox.workspace+json',
    encoding: 'utf-8',
    bom: 'forbidden',
    authority: 'optional-repository-configuration',
    loadMode: 'read-validate-build-atomic',
    compiledState: 'derived-files-only',
  };
  for (const [key, expectedValue] of Object.entries(expected)) {
    assertExactValue(projectFile[key], expectedValue, `productExperience.projectFile.${key}`);
  }
};

const validateAgentDecision = (value) => {
  const decision = assertClosedOrderedRecord(
    value,
    'productExperience.agentDecision',
    MANIFEST_KEYS.agentDecision,
  );
  assertExactValue(
    decision.compilationAuthority,
    'agent',
    'productExperience.agentDecision.compilationAuthority',
  );
  assertExactValue(
    decision.confirmationRequired,
    false,
    'productExperience.agentDecision.confirmationRequired',
  );
  assertExactTextArray(
    decision.requiredEvidence,
    AGENT_DECISION_EVIDENCE,
    'productExperience.agentDecision.requiredEvidence',
  );
};

const validateProductExperience = (value) => {
  const product = assertClosedOrderedRecord(
    value,
    'productExperience',
    MANIFEST_KEYS.productExperience,
  );
  assertExactValue(
    product.interactionModel,
    'ai-authored-ai-compiled-human-observed',
    'productExperience.interactionModel',
  );
  assertExactValue(
    product.canonicalAuthority,
    'native-ashfox-source',
    'productExperience.canonicalAuthority',
  );
  validateProjectFile(product.projectFile);
  assertExactTextArray(
    product.humanCapabilities,
    HUMAN_CAPABILITIES,
    'productExperience.humanCapabilities',
  );
  assertExactTextArray(
    product.agentCapabilities,
    AGENT_CAPABILITIES,
    'productExperience.agentCapabilities',
  );
  assertExactTextArray(
    product.forbiddenHumanAuthoring,
    FORBIDDEN_HUMAN_AUTHORING,
    'productExperience.forbiddenHumanAuthoring',
  );
  validateAgentDecision(product.agentDecision);
  assertExactValue(product.deliveryAuthority, 'human', 'productExperience.deliveryAuthority');
};

const validateEngineeringStyle = (value) => {
  const style = assertClosedOrderedRecord(
    value,
    'engineering.style',
    MANIFEST_KEYS.engineeringStyle,
  );
  assertExactValue(style.typescriptStrict, true, 'engineering.style.typescriptStrict');
  assertExactValue(style.formatter, 'prettier', 'engineering.style.formatter');
  assertExactValue(style.printWidth, 100, 'engineering.style.printWidth');
  assertExactValue(style.indentSpaces, 2, 'engineering.style.indentSpaces');
  assertExactValue(style.quotes, 'single', 'engineering.style.quotes');
  assertExactValue(style.semicolons, 'required', 'engineering.style.semicolons');
  assertExactValue(
    style.readonlyPublicContracts,
    true,
    'engineering.style.readonlyPublicContracts',
  );
  assertExactValue(style.mutableDraftsPrivate, true, 'engineering.style.mutableDraftsPrivate');
};

const validateEngineeringPrinciples = (principles) => {
  if (!isDenseContractArray(principles) || principles.length !== ENGINEERING_PRINCIPLE_IDS.length) {
    fail('engineering.principles', `must define exactly: ${ENGINEERING_PRINCIPLE_IDS.join(', ')}`);
  }
  const enforcers = new Set(ENGINEERING_ENFORCERS);
  for (let index = 0; index < ENGINEERING_PRINCIPLE_IDS.length; index += 1) {
    const location = `engineering.principles[${index}]`;
    const principle = assertClosedOrderedRecord(
      principles[index],
      location,
      MANIFEST_KEYS.engineeringPrinciple,
    );
    assertExactValue(principle.id, ENGINEERING_PRINCIPLE_IDS[index], `${location}.id`);
    if (!isNonEmptyContractText(principle.rule)) {
      fail(`${location}.rule`, 'must be non-empty trimmed text');
    }
    assertSortedUniqueTextArray(principle.enforcedBy, `${location}.enforcedBy`, (entry) =>
      enforcers.has(entry),
    );
  }
};

const validateEngineeringTesting = (value) => {
  const testing = assertClosedOrderedRecord(
    value,
    'engineering.testing',
    MANIFEST_KEYS.engineeringTesting,
  );
  assertExactValue(
    testing.behaviorChangeRequiresRegression,
    true,
    'engineering.testing.behaviorChangeRequiresRegression',
  );
  assertExactTextArray(
    testing.statefulPaths,
    STATEFUL_TEST_PATHS,
    'engineering.testing.statefulPaths',
  );
  assertExactValue(
    testing.userVisibleChangeRequiresDocs,
    true,
    'engineering.testing.userVisibleChangeRequiresDocs',
  );
};

const validateEngineering = (value) => {
  const engineering = assertClosedOrderedRecord(value, 'engineering', MANIFEST_KEYS.engineering);
  validateEngineeringStyle(engineering.style);
  validateEngineeringPrinciples(engineering.principles);
  validateEngineeringTesting(engineering.testing);
  if (!isDenseContractArray(engineering.exceptions) || engineering.exceptions.length !== 0) {
    fail('engineering.exceptions', 'must be empty in schema version 1');
  }
};

const validateWorkflow = (value) => {
  const workflow = assertClosedOrderedRecord(value, 'workflow', MANIFEST_KEYS.workflow);
  const expected = {
    dirtyWorktree: 'preserve-unrelated',
    changeScope: 'smallest-complete-slice',
    publicContractChange: 'reader-version-contract-test',
    generatedArtifacts: 'edit-source-only',
  };
  for (const [key, expectedValue] of Object.entries(expected)) {
    assertExactValue(workflow[key], expectedValue, `workflow.${key}`);
  }

  const commits = assertClosedOrderedRecord(
    workflow.commits,
    'workflow.commits',
    MANIFEST_KEYS.commits,
  );
  assertExactValue(commits.format, 'conventional-commits', 'workflow.commits.format');
  assertExactValue(commits.subject, 'imperative', 'workflow.commits.subject');
  assertExactTextArray(commits.types, COMMIT_TYPES, 'workflow.commits.types');
  assertExactValue(commits.atomic, true, 'workflow.commits.atomic');
  assertExactValue(
    commits.breakingChangeRequiresReview,
    true,
    'workflow.commits.breakingChangeRequiresReview',
  );

  const verification = assertClosedOrderedRecord(
    workflow.verification,
    'workflow.verification',
    MANIFEST_KEYS.verification,
  );
  assertExactValue(verification.duringChange, 'focused', 'workflow.verification.duringChange');
  assertExactTextArray(
    verification.beforeHandoff,
    ['git diff --check'],
    'workflow.verification.beforeHandoff',
  );
  assertExactTextArray(
    verification.beforePullRequest,
    ['npm run quality'],
    'workflow.verification.beforePullRequest',
  );
};

const validateProductVersioning = (value, repoRoot) => {
  const product = assertClosedOrderedRecord(
    value,
    'versioning.product',
    MANIFEST_KEYS.productVersioning,
  );
  const expectedProduct = {
    scheme: 'semver',
    sourceOfTruth: 'package.json',
    automation: 'release-please',
    changeOwner: 'release-pr',
    verification: 'npm run release:validate',
  };
  for (const [key, expectedValue] of Object.entries(expectedProduct)) {
    assertExactValue(product[key], expectedValue, `versioning.product.${key}`);
  }
  assertExactTextArray(
    product.synchronizedFiles,
    SYNCHRONIZED_PRODUCT_VERSION_FILES,
    'versioning.product.synchronizedFiles',
  );
  assertExistingFile(repoRoot, product.sourceOfTruth, 'versioning.product.sourceOfTruth');
  for (let index = 0; index < product.synchronizedFiles.length; index += 1) {
    assertExistingFile(
      repoRoot,
      product.synchronizedFiles[index],
      `versioning.product.synchronizedFiles[${index}]`,
    );
  }
};

const validateAssetWorkspaceVersioning = (value, repoRoot) => {
  const assetWorkspace = assertClosedOrderedRecord(
    value,
    'versioning.assetWorkspace',
    MANIFEST_KEYS.assetWorkspaceVersioning,
  );
  const expectedWorkspace = {
    version: 2,
    sourceGrammar: 'ashfox-model 1',
    container: 'ashfox-workspace:2',
    compatibility: 'exact-current-contract',
    authority: 'packages/engine-core/src/project/directory/contract.ts',
    compiler: 'packages/engine-core/src/compiler/directory/compile.ts',
    releaseState: 'unreleased',
    replacementPolicy: 'apply-complete-change-set-atomically',
    legacyAliases: 'forbidden',
  };
  for (const [key, expectedValue] of Object.entries(expectedWorkspace)) {
    assertExactValue(assetWorkspace[key], expectedValue, `versioning.assetWorkspace.${key}`);
  }
  for (const key of ['authority', 'compiler']) {
    assertExistingFile(repoRoot, assetWorkspace[key], `versioning.assetWorkspace.${key}`);
  }
};

const validateDeliveryTargetVersioning = (value) => {
  const deliveryTargets = assertClosedOrderedRecord(
    value,
    'versioning.deliveryTargets',
    MANIFEST_KEYS.deliveryTargetVersioning,
  );
  assertExactValue(
    deliveryTargets.scope,
    'source-defaults-with-optional-workspace-overrides',
    'versioning.deliveryTargets.scope',
  );
  assertExactValue(
    deliveryTargets.canonicalMutation,
    false,
    'versioning.deliveryTargets.canonicalMutation',
  );
};

const validateVersioning = (value, repoRoot) => {
  const versioning = assertClosedOrderedRecord(value, 'versioning', MANIFEST_KEYS.versioning);
  validateProductVersioning(versioning.product, repoRoot);
  validateAssetWorkspaceVersioning(versioning.assetWorkspace, repoRoot);
  validateDeliveryTargetVersioning(versioning.deliveryTargets);
};

module.exports = {
  validateEngineering,
  validateProductExperience,
  validateVersioning,
  validateWorkflow,
};
