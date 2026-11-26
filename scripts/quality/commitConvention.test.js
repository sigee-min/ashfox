'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const { commitConventionViolations, revisionRange } = require('./commitConvention');

const policy = {
  format: 'conventional-commits',
  subject: 'imperative',
  types: ['chore', 'docs', 'feat', 'fix', 'refactor', 'test'],
  atomic: true,
  breakingChangeRequiresReview: true,
};
const commit = (subject, body = '') => ({
  hash: '0123456789abcdef0123456789abcdef01234567',
  subject,
  body,
});

assert.deepEqual(
  commitConventionViolations(policy, [
    commit('feat(engine): harden compiler authority'),
    commit(
      'refactor(web)!: remove human compilation controls',
      'BREAKING CHANGE: the human confirmation port is removed.',
    ),
  ]),
  [],
);

for (const invalid of [
  commit('Harden compiler authority'),
  commit('build: harden compiler authority'),
  commit('fix: Fixed compiler authority'),
  commit('fix: harden compiler authority.'),
  commit('feat!: remove confirmation controls'),
  commit(
    'feat: remove confirmation controls',
    'BREAKING CHANGE: confirmation is no longer a human action.',
  ),
]) {
  assert.ok(
    commitConventionViolations(policy, [invalid]).length > 0,
    `expected commit to fail: ${invalid.subject}`,
  );
}

const fallbackRange = revisionRange(path.resolve(__dirname, '..', '..'), {
  ASHFOX_COMMIT_BASE: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
});
assert.ok(fallbackRange === 'HEAD' || fallbackRange.endsWith('..HEAD'));

console.log('commit convention fixtures ok');
