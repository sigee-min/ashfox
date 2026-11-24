'use strict';

const {
  fail,
  isDirectoryPrefix,
  isRepositoryDirectoryPrefix,
  isRepositoryPath,
  MANIFEST_KEYS,
  SOURCE_SCOPE_PATTERN,
  textCompare,
} = require('./contract');
const {
  assertClosedOrderedRecord,
  assertExistingDirectory,
  assertExistingFile,
  assertSortedUniqueTextArray,
  assertSortedUniqueTextArrayOrEmpty,
  isDenseContractArray,
  isNonEmptyContractText,
} = require('./reader');

const DEPENDENCY_SECTIONS = new Set([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]);
const DEPENDENCY_POLICY_MODES = new Set(['allow-only', 'deny-prefixes']);

const validateWorkspaceScopes = (scopes, repoRoot, workspaces) => {
  assertSortedUniqueTextArray(scopes, 'architecture.workspaceSourceScopes', (entry) =>
    SOURCE_SCOPE_PATTERN.test(entry),
  );
  for (let index = 0; index < scopes.length; index += 1) {
    const scope = scopes[index];
    assertExistingDirectory(repoRoot, scope, `architecture.workspaceSourceScopes[${index}]`);
    if (
      !workspaces.some(
        (workspace) => typeof workspace === 'string' && workspace.startsWith(`${scope}/`),
      )
    ) {
      fail(
        `architecture.workspaceSourceScopes[${index}]`,
        `does not own a package.json workspace: ${scope}`,
      );
    }
  }
  for (const workspace of workspaces) {
    if (
      typeof workspace !== 'string' ||
      !scopes.some((scope) => workspace.startsWith(`${scope}/`))
    ) {
      fail(
        'architecture.workspaceSourceScopes',
        `does not cover package.json workspace ${JSON.stringify(workspace)}`,
      );
    }
  }
};

const validateWorkspacePolicy = (value, workspaces) => {
  const policy = assertClosedOrderedRecord(
    value,
    'architecture.workspacePolicy',
    MANIFEST_KEYS.workspacePolicy,
  );
  const workspacePath = (entry) => isRepositoryPath(entry) && entry.includes('/');
  assertSortedUniqueTextArray(
    policy.required,
    'architecture.workspacePolicy.required',
    workspacePath,
  );
  assertSortedUniqueTextArray(
    policy.forbidden,
    'architecture.workspacePolicy.forbidden',
    workspacePath,
  );
  const actual = new Set(workspaces);
  for (const required of policy.required) {
    if (!actual.has(required)) {
      fail('architecture.workspacePolicy.required', `required workspace is missing: ${required}`);
    }
  }
  for (const forbidden of policy.forbidden) {
    if (actual.has(forbidden)) {
      fail(
        'architecture.workspacePolicy.forbidden',
        `forbidden workspace is present: ${forbidden}`,
      );
    }
    if (policy.required.includes(forbidden)) {
      fail(
        'architecture.workspacePolicy',
        `workspace cannot be required and forbidden: ${forbidden}`,
      );
    }
  }
};

const validateTombstones = (values) => {
  assertSortedUniqueTextArray(values, 'architecture.tombstones', isRepositoryPath);
};

const validatePackageDependencyPolicies = (values, repoRoot, workspaces) => {
  if (!isDenseContractArray(values) || values.length === 0) {
    fail('architecture.packageDependencyPolicies', 'must be a non-empty dense array');
  }
  const workspaceSet = new Set(workspaces);
  let previousWorkspace = null;
  for (let index = 0; index < values.length; index += 1) {
    const location = `architecture.packageDependencyPolicies[${index}]`;
    const policy = assertClosedOrderedRecord(
      values[index],
      location,
      MANIFEST_KEYS.packageDependencyPolicy,
    );
    if (!isRepositoryPath(policy.workspace) || !workspaceSet.has(policy.workspace)) {
      fail(`${location}.workspace`, 'must name a current workspace');
    }
    if (previousWorkspace !== null && textCompare(previousWorkspace, policy.workspace) >= 0) {
      fail('architecture.packageDependencyPolicies', 'must be unique and ordered by workspace');
    }
    previousWorkspace = policy.workspace;
    assertExistingFile(repoRoot, `${policy.workspace}/package.json`, `${location}.workspace`);
    assertSortedUniqueTextArray(policy.sections, `${location}.sections`, (entry) =>
      DEPENDENCY_SECTIONS.has(entry),
    );
    if (!DEPENDENCY_POLICY_MODES.has(policy.mode)) {
      fail(`${location}.mode`, 'must be allow-only or deny-prefixes');
    }
    assertSortedUniqueTextArray(policy.values, `${location}.values`, (entry) =>
      isNonEmptyContractText(entry),
    );
  }
};

const validateSourceImportBoundaries = (values, repoRoot) => {
  if (!isDenseContractArray(values) || values.length === 0) {
    fail('architecture.sourceImportBoundaries', 'must be a non-empty dense array');
  }
  let previousSource = null;
  for (let index = 0; index < values.length; index += 1) {
    const location = `architecture.sourceImportBoundaries[${index}]`;
    const boundary = assertClosedOrderedRecord(
      values[index],
      location,
      MANIFEST_KEYS.sourceImportBoundary,
    );
    if (!isRepositoryDirectoryPrefix(boundary.source)) {
      fail(`${location}.source`, 'must be a normalized directory prefix');
    }
    if (previousSource !== null && textCompare(previousSource, boundary.source) >= 0) {
      fail('architecture.sourceImportBoundaries', 'must be unique and ordered by source');
    }
    previousSource = boundary.source;
    assertExistingDirectory(repoRoot, boundary.source, `${location}.source`);
    assertSortedUniqueTextArray(boundary.extensions, `${location}.extensions`, (entry) =>
      /^\.[a-z0-9]+$/.test(entry),
    );
    assertSortedUniqueTextArrayOrEmpty(
      boundary.allowedExternalImports,
      `${location}.allowedExternalImports`,
      isNonEmptyContractText,
    );
    for (const key of ['forbiddenExternalPrefixes', 'forbiddenExternalPackageRoots']) {
      assertSortedUniqueTextArray(boundary[key], `${location}.${key}`, isNonEmptyContractText);
    }
    assertSortedUniqueTextArray(
      boundary.forbiddenRelativeTargets,
      `${location}.forbiddenRelativeTargets`,
      isRepositoryDirectoryPrefix,
    );
    for (
      let targetIndex = 0;
      targetIndex < boundary.forbiddenRelativeTargets.length;
      targetIndex += 1
    ) {
      assertExistingDirectory(
        repoRoot,
        boundary.forbiddenRelativeTargets[targetIndex],
        `${location}.forbiddenRelativeTargets[${targetIndex}]`,
      );
    }
  }
};

const validateForbiddenDependencyRule = (ruleValue, index, previousSource, scopes, repoRoot) => {
  const location = `architecture.forbiddenDependencies[${index}]`;
  const rule = assertClosedOrderedRecord(ruleValue, location, MANIFEST_KEYS.forbiddenDependency);
  if (!isNonEmptyContractText(rule.source) || !isDirectoryPrefix(rule.source)) {
    fail(`${location}.source`, 'must be a normalized directory prefix');
  }
  if (previousSource !== null && textCompare(previousSource, rule.source) >= 0) {
    fail('architecture.forbiddenDependencies', 'rules must have unique sources in ascending order');
  }
  if (!scopes.some((scope) => rule.source.startsWith(`${scope}/`))) {
    fail(`${location}.source`, 'must be below a workspace source scope');
  }
  assertExistingDirectory(repoRoot, rule.source, `${location}.source`);
  assertSortedUniqueTextArray(rule.targets, `${location}.targets`, isDirectoryPrefix);
  for (let targetIndex = 0; targetIndex < rule.targets.length; targetIndex += 1) {
    const target = rule.targets[targetIndex];
    const targetLocation = `${location}.targets[${targetIndex}]`;
    if (target === rule.source) {
      fail(targetLocation, 'must not equal the source prefix');
    }
    if (!scopes.some((scope) => target.startsWith(`${scope}/`))) {
      fail(targetLocation, 'must be below a workspace source scope');
    }
    assertExistingDirectory(repoRoot, target, targetLocation);
  }
  return rule.source;
};

const validateForbiddenDependencies = (values, scopes, repoRoot) => {
  if (!isDenseContractArray(values) || values.length === 0) {
    fail('architecture.forbiddenDependencies', 'must be a non-empty dense array');
  }
  let previousSource = null;
  for (let index = 0; index < values.length; index += 1) {
    previousSource = validateForbiddenDependencyRule(
      values[index],
      index,
      previousSource,
      scopes,
      repoRoot,
    );
  }
};

const validateArchitecture = (value, repoRoot, workspaces) => {
  const architecture = assertClosedOrderedRecord(value, 'architecture', MANIFEST_KEYS.architecture);
  validateWorkspaceScopes(architecture.workspaceSourceScopes, repoRoot, workspaces);
  validateWorkspacePolicy(architecture.workspacePolicy, workspaces);
  validateTombstones(architecture.tombstones);
  validatePackageDependencyPolicies(architecture.packageDependencyPolicies, repoRoot, workspaces);
  validateSourceImportBoundaries(architecture.sourceImportBoundaries, repoRoot);
  validateForbiddenDependencies(
    architecture.forbiddenDependencies,
    architecture.workspaceSourceScopes,
    repoRoot,
  );
};

module.exports = { validateArchitecture };
