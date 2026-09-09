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
  SYNCHRONIZED_PRODUCT_VERSION_FILES
} = require('./contract');
const {
  assertClosedOrderedRecord,
  assertExactTextArray,
  assertExactValue,
  assertExistingFile,
  assertSortedUniqueTextArray,
  isDenseContractArray,
  isNonEmptyContractText
} = require('./reader');

const validateProductExperience = (value) => {
  const product = assertClosedOrderedRecord(
    value,
    'productExperience',
    MANIFEST_KEYS.productExperience
  );
  assertExactValue(
    product.interactionModel,
    'ai-authored-ai-compiled-human-observed',
    'productExperience.interactionModel'
  );
  assertExactValue(
    product.canonicalAuthority,
    'native-ashfox-source',
    'productExperience.canonicalAuthority'
  );
  const projectFile = assertClosedOrderedRecord(
    product.projectFile,
    'productExperience.projectFile',
    MANIFEST_KEYS.projectFile
  );
  assertExactValue(
    projectFile.extension,
    '.ashfoxworkspace',
    'productExperience.projectFile.extension'
  );
  assertExactValue(
    projectFile.mediaType,
    'application/vnd.ashfox.workspace+json',
    'productExperience.projectFile.mediaType'
  );
  assertExactValue(
    projectFile.encoding,
    'utf-8',
    'productExperience.projectFile.encoding'
  );
  assertExactValue(
    projectFile.bom,
    'forbidden',
    'productExperience.projectFile.bom'
  );
  assertExactValue(
    projectFile.authority,
    'optional-repository-configuration',
    'productExperience.projectFile.authority'
  );
  assertExactValue(
    projectFile.loadMode,
    'read-validate-build-atomic',
    'productExperience.projectFile.loadMode'
  );
  assertExactValue(
    projectFile.compiledState,
    'derived-files-only',
    'productExperience.projectFile.compiledState'
  );
  assertExactTextArray(
    product.humanCapabilities,
    HUMAN_CAPABILITIES,
    'productExperience.humanCapabilities'
  );
  assertExactTextArray(
    product.agentCapabilities,
    AGENT_CAPABILITIES,
    'productExperience.agentCapabilities'
  );
  assertExactTextArray(
    product.forbiddenHumanAuthoring,
    FORBIDDEN_HUMAN_AUTHORING,
    'productExperience.forbiddenHumanAuthoring'
  );
  const decision = assertClosedOrderedRecord(
    product.agentDecision,
    'productExperience.agentDecision',
    MANIFEST_KEYS.agentDecision
  );
  assertExactValue(
    decision.compilationAuthority,
    'agent',
    'productExperience.agentDecision.compilationAuthority'
  );
  assertExactValue(
    decision.confirmationRequired,
    false,
    'productExperience.agentDecision.confirmationRequired'
  );
  assertExactTextArray(
    decision.requiredEvidence,
    AGENT_DECISION_EVIDENCE,
    'productExperience.agentDecision.requiredEvidence'
  );
  assertExactValue(
    product.deliveryAuthority,
    'human',
    'productExperience.deliveryAuthority'
  );
};

const validateEngineeringStyle = (value) => {
  const style = assertClosedOrderedRecord(
    value,
    'engineering.style',
    MANIFEST_KEYS.engineeringStyle
  );
  assertExactValue(style.typescriptStrict, true, 'engineering.style.typescriptStrict');
  assertExactValue(style.indentSpaces, 2, 'engineering.style.indentSpaces');
  assertExactValue(style.quotes, 'single', 'engineering.style.quotes');
  assertExactValue(style.semicolons, 'required', 'engineering.style.semicolons');
  assertExactValue(
    style.readonlyPublicContracts,
    true,
    'engineering.style.readonlyPublicContracts'
  );
  assertExactValue(
    style.mutableDraftsPrivate,
    true,
    'engineering.style.mutableDraftsPrivate'
  );
};

const validateEngineeringPrinciples = (principles) => {
  if (!isDenseContractArray(principles) ||
      principles.length !== ENGINEERING_PRINCIPLE_IDS.length) {
    fail(
      'engineering.principles',
      `must define exactly: ${ENGINEERING_PRINCIPLE_IDS.join(', ')}`
    );
  }
  const enforcers = new Set(ENGINEERING_ENFORCERS);
  for (let index = 0; index < ENGINEERING_PRINCIPLE_IDS.length; index += 1) {
    const location = `engineering.principles[${index}]`;
    const principle = assertClosedOrderedRecord(
      principles[index],
      location,
      MANIFEST_KEYS.engineeringPrinciple
    );
    assertExactValue(
      principle.id,
      ENGINEERING_PRINCIPLE_IDS[index],
      `${location}.id`
    );
    if (!isNonEmptyContractText(principle.rule)) {
      fail(`${location}.rule`, 'must be non-empty trimmed text');
    }
    assertSortedUniqueTextArray(
      principle.enforcedBy,
      `${location}.enforcedBy`,
      (entry) => enforcers.has(entry)
    );
  }
};

const validateEngineeringTesting = (value) => {
  const testing = assertClosedOrderedRecord(
    value,
    'engineering.testing',
    MANIFEST_KEYS.engineeringTesting
  );
  assertExactValue(
    testing.behaviorChangeRequiresRegression,
    true,
    'engineering.testing.behaviorChangeRequiresRegression'
  );
  assertExactTextArray(
    testing.statefulPaths,
    STATEFUL_TEST_PATHS,
    'engineering.testing.statefulPaths'
  );
  assertExactValue(
    testing.userVisibleChangeRequiresDocs,
    true,
    'engineering.testing.userVisibleChangeRequiresDocs'
  );
};

const validateEngineering = (value) => {
  const engineering = assertClosedOrderedRecord(
    value,
    'engineering',
    MANIFEST_KEYS.engineering
  );
  validateEngineeringStyle(engineering.style);
  validateEngineeringPrinciples(engineering.principles);
  validateEngineeringTesting(engineering.testing);
  if (!isDenseContractArray(engineering.exceptions) ||
      engineering.exceptions.length !== 0) {
    fail('engineering.exceptions', 'must be empty in schema version 1');
  }
};

const validateWorkflow = (value) => {
  const workflow = assertClosedOrderedRecord(
    value,
    'workflow',
    MANIFEST_KEYS.workflow
  );
  const expected = {
    dirtyWorktree: 'preserve-unrelated',
    changeScope: 'smallest-complete-slice',
    publicContractChange: 'reader-version-contract-test',
    generatedArtifacts: 'edit-source-only'
  };
  for (const [key, expectedValue] of Object.entries(expected)) {
    assertExactValue(workflow[key], expectedValue, `workflow.${key}`);
  }

  const commits = assertClosedOrderedRecord(
    workflow.commits,
    'workflow.commits',
    MANIFEST_KEYS.commits
  );
  assertExactValue(commits.format, 'conventional-commits', 'workflow.commits.format');
  assertExactValue(commits.subject, 'imperative', 'workflow.commits.subject');
  assertExactTextArray(commits.types, COMMIT_TYPES, 'workflow.commits.types');
  assertExactValue(commits.atomic, true, 'workflow.commits.atomic');
  assertExactValue(
    commits.breakingChangeRequiresReview,
    true,
    'workflow.commits.breakingChangeRequiresReview'
  );

  const verification = assertClosedOrderedRecord(
    workflow.verification,
    'workflow.verification',
    MANIFEST_KEYS.verification
  );
  assertExactValue(
    verification.duringChange,
    'focused',
    'workflow.verification.duringChange'
  );
  assertExactTextArray(
    verification.beforeHandoff,
    ['git diff --check'],
    'workflow.verification.beforeHandoff'
  );
  assertExactTextArray(
    verification.beforePullRequest,
    ['npm run quality'],
    'workflow.verification.beforePullRequest'
  );
};

const validateVersioning = (value, repoRoot) => {
  const versioning = assertClosedOrderedRecord(
    value,
    'versioning',
    MANIFEST_KEYS.versioning
  );
  const product = assertClosedOrderedRecord(
    versioning.product,
    'versioning.product',
    MANIFEST_KEYS.productVersioning
  );
  const expectedProduct = {
    scheme: 'semver',
    sourceOfTruth: 'package.json',
    automation: 'release-please',
    changeOwner: 'release-pr',
    verification: 'npm run release:validate'
  };
  for (const [key, expectedValue] of Object.entries(expectedProduct)) {
    assertExactValue(product[key], expectedValue, `versioning.product.${key}`);
  }
  assertExactTextArray(
    product.synchronizedFiles,
    SYNCHRONIZED_PRODUCT_VERSION_FILES,
    'versioning.product.synchronizedFiles'
  );
  assertExistingFile(repoRoot, product.sourceOfTruth, 'versioning.product.sourceOfTruth');
  for (let index = 0; index < product.synchronizedFiles.length; index += 1) {
    assertExistingFile(
      repoRoot,
      product.synchronizedFiles[index],
      `versioning.product.synchronizedFiles[${index}]`
    );
  }

  const assetWorkspace = assertClosedOrderedRecord(
    versioning.assetWorkspace,
    'versioning.assetWorkspace',
    MANIFEST_KEYS.assetWorkspaceVersioning
  );
  assertExactValue(
    assetWorkspace.version,
    2,
    'versioning.assetWorkspace.version'
  );
  assertExactValue(
    assetWorkspace.sourceGrammar,
    'ashfox-model 1',
    'versioning.assetWorkspace.sourceGrammar'
  );
  assertExactValue(
    assetWorkspace.container,
    'ashfox-workspace:2',
    'versioning.assetWorkspace.container'
  );
  assertExactValue(
    assetWorkspace.compatibility,
    'exact-current-contract',
    'versioning.assetWorkspace.compatibility'
  );
  assertExactValue(
    assetWorkspace.authority,
    'packages/engine-core/src/project/directory/contract.ts',
    'versioning.assetWorkspace.authority'
  );
  assertExactValue(
    assetWorkspace.compiler,
    'packages/engine-core/src/compiler/directory/compile.ts',
    'versioning.assetWorkspace.compiler'
  );
  assertExactValue(
    assetWorkspace.releaseState,
    'unreleased',
    'versioning.assetWorkspace.releaseState'
  );
  assertExactValue(
    assetWorkspace.replacementPolicy,
    'apply-complete-change-set-atomically',
    'versioning.assetWorkspace.replacementPolicy'
  );
  assertExactValue(assetWorkspace.legacyAliases, 'forbidden',
    'versioning.assetWorkspace.legacyAliases');
  for (const key of ['authority', 'compiler']) {
    assertExistingFile(
      repoRoot,
      assetWorkspace[key],
      `versioning.assetWorkspace.${key}`
    );
  }

  const deliveryTargets = assertClosedOrderedRecord(
    versioning.deliveryTargets,
    'versioning.deliveryTargets',
    MANIFEST_KEYS.deliveryTargetVersioning
  );
  assertExactValue(
    deliveryTargets.scope,
    'source-defaults-with-optional-workspace-overrides',
    'versioning.deliveryTargets.scope'
  );
  assertExactValue(
    deliveryTargets.canonicalMutation,
    false,
    'versioning.deliveryTargets.canonicalMutation'
  );
};

module.exports = {
  validateEngineering,
  validateProductExperience,
  validateVersioning,
  validateWorkflow
};
