'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { compareText } = require('../shared');

const canonicalPath = (value) => value.replace(/\\/g, '/');
const compareCodeUnits = (left, right) => compareText(canonicalPath(left), canonicalPath(right));

const discoverTests = (directory, suffix = '.test.ts') => {
  const files = [];
  const visit = (owner) => {
    const entries = fs
      .readdirSync(owner, { withFileTypes: true })
      .sort((left, right) => compareCodeUnits(left.name, right.name));
    for (const entry of entries) {
      const target = path.join(owner, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name.endsWith(suffix)) {
        files.push(target);
      }
    }
  };
  visit(directory);
  return files.sort(compareCodeUnits);
};

const selectTests = (tests, options = {}) => {
  const filter = options.filter;
  const selected = filter ? tests.filter((test) => test.includes(filter)) : tests;
  if (selected.length === 0) {
    const label = options.label || 'test files';
    throw new Error(filter ? `No ${label} matched filter: ${filter}` : `No ${label} discovered.`);
  }
  return selected;
};

const requireTests = (tests) => tests.map((test) => require(test));

module.exports = {
  compareCodeUnits,
  discoverTests,
  requireTests,
  selectTests,
};
