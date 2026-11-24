'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  hasExactContractKeys,
  isClosedContractRecord,
  isDenseContractArray,
  isNonEmptyContractText,
} = require('@ashfox/internal-contracts');
const { fail, textCompare } = require('./contract');

const assertClosedOrderedRecord = (value, location, keys) => {
  if (!isClosedContractRecord(value)) {
    fail(location, 'must be a closed plain object');
  }
  if (!hasExactContractKeys(value, new Set(keys))) {
    fail(location, `must contain exactly: ${keys.join(', ')}`);
  }
  const actualKeys = Object.keys(value);
  if (!keys.every((key, index) => actualKeys[index] === key)) {
    fail(location, `keys must be ordered as: ${keys.join(', ')}`);
  }
  return value;
};

const assertExactValue = (value, expected, location) => {
  if (value !== expected) {
    fail(location, `must be ${JSON.stringify(expected)}`);
  }
};

const assertExactTextArray = (value, expected, location) => {
  if (!isDenseContractArray(value) || value.length !== expected.length) {
    fail(location, `must be exactly [${expected.join(', ')}]`);
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (value[index] !== expected[index]) {
      fail(location, `must be exactly [${expected.join(', ')}]`);
    }
  }
};

const assertPositiveSafeInteger = (value, location) => {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(location, 'must be a positive safe integer');
  }
};

const assertOrderedUniqueTextArray = (value, location, itemValidator, minimumLength) => {
  if (!isDenseContractArray(value) || value.length < minimumLength) {
    fail(
      location,
      minimumLength === 0 ? 'must be a dense array' : 'must be a non-empty dense array',
    );
  }
  let previous = null;
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (!isNonEmptyContractText(entry) || !itemValidator(entry)) {
      fail(`${location}[${index}]`, 'is invalid');
    }
    if (previous !== null && textCompare(previous, entry) >= 0) {
      fail(location, 'must contain unique values in ascending order');
    }
    previous = entry;
  }
};

const assertSortedUniqueTextArray = (value, location, itemValidator = () => true) =>
  assertOrderedUniqueTextArray(value, location, itemValidator, 1);

const assertSortedUniqueTextArrayOrEmpty = (value, location, itemValidator = () => true) =>
  assertOrderedUniqueTextArray(value, location, itemValidator, 0);

const resolveInsideRepo = (repoRoot, relativePath, location) => {
  const resolved = path.resolve(repoRoot, relativePath);
  const relative = path.relative(repoRoot, resolved);
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    fail(location, 'must resolve to a path below the repository root');
  }
  return resolved;
};

const assertExistingFile = (repoRoot, relativePath, location) => {
  const resolved = resolveInsideRepo(repoRoot, relativePath, location);
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    fail(location, `does not exist: ${relativePath}`);
  }
  if (!stat.isFile()) fail(location, `must name a file: ${relativePath}`);
};

const assertExistingDirectory = (repoRoot, relativePath, location) => {
  const resolved = resolveInsideRepo(repoRoot, relativePath, location);
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    fail(location, `does not exist: ${relativePath}`);
  }
  if (!stat.isDirectory()) {
    fail(location, `must name a directory: ${relativePath}`);
  }
};

const readRootPackageWorkspaces = (repoRoot) => {
  const packagePath = path.join(repoRoot, 'package.json');
  let rootPackage;
  try {
    rootPackage = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  } catch {
    fail('versioning.product.sourceOfTruth', 'package.json must be readable JSON');
  }
  if (!isClosedContractRecord(rootPackage)) {
    fail('versioning.product.sourceOfTruth', 'package.json must be an object');
  }
  if (!isDenseContractArray(rootPackage.workspaces)) {
    fail('architecture.workspaceSourceScopes', 'package.json workspaces are missing');
  }
  return rootPackage.workspaces;
};

module.exports = {
  assertClosedOrderedRecord,
  assertExactTextArray,
  assertExactValue,
  assertExistingDirectory,
  assertExistingFile,
  assertPositiveSafeInteger,
  assertSortedUniqueTextArray,
  assertSortedUniqueTextArrayOrEmpty,
  isDenseContractArray,
  isNonEmptyContractText,
  readRootPackageWorkspaces,
  resolveInsideRepo,
};
