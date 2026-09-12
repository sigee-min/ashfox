'use strict';

const DEVELOPMENT_MANIFEST_FILENAME = 'development-manifest.json';
const DEVELOPMENT_MANIFEST_SCHEMA_FILENAME =
  'development-manifest.schema.json';
const DEVELOPMENT_MANIFEST_SCHEMA_REFERENCE =
  `./${DEVELOPMENT_MANIFEST_SCHEMA_FILENAME}`;
const DEVELOPMENT_MANIFEST_SCHEMA_VERSION = 1;

const frozen = (values) => Object.freeze(values);

const MANIFEST_KEYS = Object.freeze({
  root: frozen([
    '$schema',
    'schemaVersion',
    'productExperience',
    'engineering',
    'workflow',
    'versioning',
    'quality',
    'architecture'
  ]),
  productExperience: frozen([
    'interactionModel',
    'canonicalAuthority',
    'projectFile',
    'humanCapabilities',
    'agentCapabilities',
    'forbiddenHumanAuthoring',
    'agentDecision',
    'deliveryAuthority'
  ]),
  projectFile: frozen([
    'extension',
    'mediaType',
    'encoding',
    'bom',
    'authority',
    'loadMode',
    'compiledState'
  ]),
  agentDecision: frozen([
    'compilationAuthority',
    'confirmationRequired',
    'requiredEvidence'
  ]),
  engineering: frozen(['style', 'principles', 'testing', 'exceptions']),
  engineeringStyle: frozen([
    'typescriptStrict',
    'indentSpaces',
    'quotes',
    'semicolons',
    'readonlyPublicContracts',
    'mutableDraftsPrivate'
  ]),
  engineeringPrinciple: frozen(['id', 'rule', 'enforcedBy']),
  engineeringTesting: frozen([
    'behaviorChangeRequiresRegression',
    'statefulPaths',
    'userVisibleChangeRequiresDocs'
  ]),
  workflow: frozen([
    'dirtyWorktree',
    'changeScope',
    'publicContractChange',
    'generatedArtifacts',
    'commits',
    'verification'
  ]),
  commits: frozen([
    'format',
    'subject',
    'types',
    'atomic',
    'breakingChangeRequiresReview'
  ]),
  verification: frozen([
    'duringChange',
    'beforeHandoff',
    'beforePullRequest'
  ]),
  versioning: frozen([
    'product',
    'assetWorkspace',
    'deliveryTargets'
  ]),
  productVersioning: frozen([
    'scheme',
    'sourceOfTruth',
    'automation',
    'synchronizedFiles',
    'changeOwner',
    'verification'
  ]),
  assetWorkspaceVersioning: frozen([
    'version',
    'sourceGrammar',
    'container',
    'compatibility',
    'authority',
    'compiler',
    'releaseState',
    'replacementPolicy',
    'legacyAliases'
  ]),
  deliveryTargetVersioning: frozen(['scope', 'canonicalMutation']),
  quality: frozen([
    'maxSourceFileLines',
    'maxCodeFileStemLength',
    'newSourceFileRatchetLines',
    'maxFunctionLines',
    'ownerLayout',
    'forbiddenSourcePatterns'
  ]),
  ownerLayout: frozen([
    'contractFile',
    'testFileSuffix',
    'testFileExtension',
    'testFileStem',
    'maxTestFileStemLength',
    'maxTestFileLines',
    'testOwnership',
    'testDiscovery',
    'testOwners'
  ]),
  testOwner: frozen(['workspace', 'roots']),
  forbiddenSourcePattern: frozen(['id', 'scope', 'allowedPaths']),
  architecture: frozen([
    'workspaceSourceScopes',
    'workspacePolicy',
    'tombstones',
    'packageDependencyPolicies',
    'sourceImportBoundaries',
    'forbiddenDependencies'
  ]),
  workspacePolicy: frozen(['required', 'forbidden']),
  packageDependencyPolicy: frozen([
    'workspace',
    'sections',
    'mode',
    'values'
  ]),
  sourceImportBoundary: frozen([
    'source',
    'extensions',
    'allowedExternalImports',
    'forbiddenExternalPrefixes',
    'forbiddenExternalPackageRoots',
    'forbiddenRelativeTargets'
  ]),
  forbiddenDependency: frozen(['source', 'targets'])
});

const HUMAN_CAPABILITIES = frozen([
  'capture-evidence',
  'create-project',
  'download-project',
  'export-artifact',
  'observe-agent-decisions',
  'open-project',
  'prompt-agent-externally',
  'view-canonical-asset'
]);
const AGENT_CAPABILITIES = frozen([
  'apply-workspace-change-set',
  'inspect-project',
  'present-review-evidence'
]);
const FORBIDDEN_HUMAN_AUTHORING = frozen([
  'direct-animation-authoring',
  'direct-geometry-authoring',
  'direct-hierarchy-authoring',
  'direct-material-authoring',
  'direct-rig-authoring',
  'direct-texture-authoring'
]);
const AGENT_DECISION_EVIDENCE = frozen([
  'workspace-summary',
  'native-size-review',
  'technical-receipt'
]);
const ENGINEERING_PRINCIPLE_IDS = frozen([
  'atomic-mutation',
  'closed-contracts',
  'deterministic-output',
  'interface-first',
  'no-derived-write-path',
  'owner-scoped-files',
  'preserve-unrelated-work',
  'pure-core-io-adapters',
  'single-authority',
  'source-owned-diagnostics'
]);
const ENGINEERING_ENFORCERS = frozen([
  'quality:architecture',
  'quality:check',
  'review',
  'tests',
  'typecheck'
]);
const STATEFUL_TEST_PATHS = frozen([
  'success',
  'cancellation',
  'stale-revision',
  'invalid-input',
  'exception'
]);
const COMMIT_TYPES = frozen([
  'chore',
  'docs',
  'feat',
  'fix',
  'refactor',
  'test'
]);
const FORBIDDEN_SOURCE_PATTERN_IDS = frozen([
  'as-any',
  'as-unknown-as',
  'bare-document',
  'bare-window',
  'browser-authoring-contract',
  'catch-without-binding',
  'console-in-src',
  'double-assertion',
  'engine-core-host-dependency',
  'explicit-any',
  'globalThis-as',
  'throw-in-src',
  'todo-fixme-comment',
  'ts-ignore'
]);
const SYNCHRONIZED_PRODUCT_VERSION_FILES = frozen([
  '.github/release-please/manifest.json',
  'packages/blockbench-runtime/src/config.ts'
]);

const SOURCE_SCOPE_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const DIRECTORY_PREFIX_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)+\/$/;
const REPOSITORY_DIRECTORY_PREFIX_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*\/$/;
const REPOSITORY_PATH_PATTERN =
  /^[A-Za-z0-9.][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

class DevelopmentManifestError extends Error {
  constructor(location, detail) {
    super(`development manifest ${location}: ${detail}`);
    this.name = 'DevelopmentManifestError';
    this.code = 'INVALID_DEVELOPMENT_MANIFEST';
    this.location = location;
  }
}

const fail = (location, detail) => {
  throw new DevelopmentManifestError(location, detail);
};

const textCompare = (left, right) =>
  left < right ? -1 : left > right ? 1 : 0;

const isDirectoryPrefix = (value) =>
  DIRECTORY_PREFIX_PATTERN.test(value) &&
  !value.split('/').some((segment) => segment === '.' || segment === '..');

const isRepositoryDirectoryPrefix = (value) =>
  REPOSITORY_DIRECTORY_PREFIX_PATTERN.test(value) &&
  !value.split('/').some((segment) => segment === '.' || segment === '..');

const isRepositoryPath = (value) =>
  REPOSITORY_PATH_PATTERN.test(value) &&
  !value.split('/').some((segment) => segment === '.' || segment === '..');

module.exports = {
  AGENT_CAPABILITIES,
  AGENT_DECISION_EVIDENCE,
  COMMIT_TYPES,
  DevelopmentManifestError,
  DEVELOPMENT_MANIFEST_FILENAME,
  DEVELOPMENT_MANIFEST_SCHEMA_FILENAME,
  DEVELOPMENT_MANIFEST_SCHEMA_REFERENCE,
  DEVELOPMENT_MANIFEST_SCHEMA_VERSION,
  ENGINEERING_ENFORCERS,
  ENGINEERING_PRINCIPLE_IDS,
  fail,
  FORBIDDEN_HUMAN_AUTHORING,
  FORBIDDEN_SOURCE_PATTERN_IDS,
  HUMAN_CAPABILITIES,
  isDirectoryPrefix,
  isRepositoryDirectoryPrefix,
  isRepositoryPath,
  MANIFEST_KEYS,
  SOURCE_SCOPE_PATTERN,
  STATEFUL_TEST_PATHS,
  SYNCHRONIZED_PRODUCT_VERSION_FILES,
  textCompare
};
