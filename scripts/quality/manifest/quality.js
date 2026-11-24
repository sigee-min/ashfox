'use strict';

const {
  fail,
  FORBIDDEN_SOURCE_PATTERN_IDS,
  isRepositoryDirectoryPrefix,
  isRepositoryPath,
  MANIFEST_KEYS,
  textCompare,
} = require('./contract');
const {
  assertClosedOrderedRecord,
  assertExactValue,
  assertExistingDirectory,
  assertExistingFile,
  assertPositiveSafeInteger,
  assertSortedUniqueTextArray,
  assertSortedUniqueTextArrayOrEmpty,
  isDenseContractArray,
} = require('./reader');

const validateSourcePattern = (value, index, repoRoot, workspaceSourceScopes) => {
  const location = `quality.forbiddenSourcePatterns[${index}]`;
  const policy = assertClosedOrderedRecord(value, location, MANIFEST_KEYS.forbiddenSourcePattern);
  assertExactValue(policy.id, FORBIDDEN_SOURCE_PATTERN_IDS[index], `${location}.id`);
  assertSortedUniqueTextArray(policy.scope, `${location}.scope`, isRepositoryDirectoryPrefix);
  for (let scopeIndex = 0; scopeIndex < policy.scope.length; scopeIndex += 1) {
    const scope = policy.scope[scopeIndex];
    if (
      !workspaceSourceScopes.some(
        (workspaceScope) =>
          scope === `${workspaceScope}/` ||
          (scope.startsWith(`${workspaceScope}/`) && scope.includes('/src/')),
      )
    ) {
      fail(
        `${location}.scope[${scopeIndex}]`,
        'must select TypeScript workspace source files scanned by quality:check',
      );
    }
    assertExistingDirectory(repoRoot, scope, `${location}.scope[${scopeIndex}]`);
  }
  assertSortedUniqueTextArrayOrEmpty(
    policy.allowedPaths,
    `${location}.allowedPaths`,
    isRepositoryPath,
  );
  for (let pathIndex = 0; pathIndex < policy.allowedPaths.length; pathIndex += 1) {
    const allowedPath = policy.allowedPaths[pathIndex];
    const pathLocation = `${location}.allowedPaths[${pathIndex}]`;
    if (!policy.scope.some((scope) => allowedPath.startsWith(scope))) {
      fail(pathLocation, 'must be inside the declared scope');
    }
    if (!/\.tsx?$/.test(allowedPath)) {
      fail(pathLocation, 'must name a TypeScript source file');
    }
    assertExistingFile(repoRoot, allowedPath, pathLocation);
  }
};

const validateOwnerLayout = (quality, repoRoot) => {
  const owner = assertClosedOrderedRecord(
    quality.ownerLayout,
    'quality.ownerLayout',
    MANIFEST_KEYS.ownerLayout,
  );
  const fileContract = {
    contractFile: 'contract',
    testFileSuffix: '.test',
    testFileExtension: '.ts',
    testFileStem: 'lower-word',
  };
  for (const [key, expected] of Object.entries(fileContract)) {
    assertExactValue(owner[key], expected, `quality.ownerLayout.${key}`);
  }
  assertPositiveSafeInteger(
    owner.maxTestFileStemLength,
    'quality.ownerLayout.maxTestFileStemLength',
  );
  assertPositiveSafeInteger(owner.maxTestFileLines, 'quality.ownerLayout.maxTestFileLines');
  if (owner.maxTestFileLines > quality.maxSourceFileLines) {
    fail('quality.ownerLayout.maxTestFileLines', 'must not exceed quality.maxSourceFileLines');
  }
  assertExactValue(
    owner.testOwnership,
    'owner-directory-required',
    'quality.ownerLayout.testOwnership',
  );
  assertExactValue(
    owner.testDiscovery,
    'recursive-stable-nonempty',
    'quality.ownerLayout.testDiscovery',
  );
  if (!isDenseContractArray(owner.testOwners) || owner.testOwners.length === 0) {
    fail('quality.ownerLayout.testOwners', 'must be a non-empty dense array');
  }
  let previousWorkspace = null;
  for (let index = 0; index < owner.testOwners.length; index += 1) {
    const location = `quality.ownerLayout.testOwners[${index}]`;
    const testOwner = assertClosedOrderedRecord(
      owner.testOwners[index],
      location,
      MANIFEST_KEYS.testOwner,
    );
    if (!isRepositoryPath(testOwner.workspace)) {
      fail(`${location}.workspace`, 'must be a repository workspace path');
    }
    if (previousWorkspace !== null && textCompare(previousWorkspace, testOwner.workspace) >= 0) {
      fail('quality.ownerLayout.testOwners', 'workspaces must be unique and in ascending order');
    }
    previousWorkspace = testOwner.workspace;
    assertExistingDirectory(repoRoot, `${testOwner.workspace}/tests`, `${location}.workspace`);
    assertSortedUniqueTextArray(testOwner.roots, `${location}.roots`, (root) =>
      /^[a-z][a-z0-9]*$/.test(root),
    );
    for (let rootIndex = 0; rootIndex < testOwner.roots.length; rootIndex += 1) {
      assertExistingDirectory(
        repoRoot,
        `${testOwner.workspace}/tests/${testOwner.roots[rootIndex]}`,
        `${location}.roots[${rootIndex}]`,
      );
    }
  }
};

const validateQuality = (value, repoRoot, workspaceSourceScopes) => {
  const quality = assertClosedOrderedRecord(value, 'quality', MANIFEST_KEYS.quality);
  for (const key of MANIFEST_KEYS.quality.slice(0, 4)) {
    assertPositiveSafeInteger(quality[key], `quality.${key}`);
  }
  validateOwnerLayout(quality, repoRoot);
  if (
    !isDenseContractArray(quality.forbiddenSourcePatterns) ||
    quality.forbiddenSourcePatterns.length !== FORBIDDEN_SOURCE_PATTERN_IDS.length
  ) {
    fail(
      'quality.forbiddenSourcePatterns',
      `must define exactly: ${FORBIDDEN_SOURCE_PATTERN_IDS.join(', ')}`,
    );
  }
  for (let index = 0; index < quality.forbiddenSourcePatterns.length; index += 1) {
    validateSourcePattern(
      quality.forbiddenSourcePatterns[index],
      index,
      repoRoot,
      workspaceSourceScopes,
    );
  }
  if (quality.newSourceFileRatchetLines >= quality.maxSourceFileLines) {
    fail('quality.newSourceFileRatchetLines', 'must be lower than quality.maxSourceFileLines');
  }
  if (quality.maxFunctionLines > quality.newSourceFileRatchetLines) {
    fail('quality.maxFunctionLines', 'must not exceed quality.newSourceFileRatchetLines');
  }
};

module.exports = { validateQuality };
