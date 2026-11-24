'use strict';

const childProcess = require('node:child_process');
const path = require('node:path');

const { readDevelopmentManifest } = require('./manifest');

const ZERO_REVISION = /^0+$/;
const PAST_TENSE_PREFIX =
  /^(added|changed|created|documented|fixed|implemented|refactored|removed|updated)\b/i;

const commitConventionViolation = (commit, message) =>
  `${commit.hash.slice(0, 12)} ${JSON.stringify(commit.subject)}: ${message}`;

const commitConventionViolations = (policy, commits) => {
  const allowedTypes = policy.types.join('|');
  const header = new RegExp(`^(${allowedTypes})(?:\\([a-z0-9][a-z0-9._/-]*\\))?(!)?: (.+)$`);
  const violations = [];
  for (const commit of commits) {
    const match = commit.subject.match(header);
    if (!match) {
      violations.push(
        commitConventionViolation(
          commit,
          `expected ${policy.format} with type ${policy.types.join(', ')}`,
        ),
      );
      continue;
    }
    const description = match[3];
    if (description[0] !== description[0].toLowerCase()) {
      violations.push(
        commitConventionViolation(
          commit,
          'description must begin with a lowercase imperative verb',
        ),
      );
    }
    if (PAST_TENSE_PREFIX.test(description)) {
      violations.push(
        commitConventionViolation(commit, `description must be ${policy.subject}, not past tense`),
      );
    }
    if (description.endsWith('.')) {
      violations.push(commitConventionViolation(commit, 'description must not end with a period'));
    }
    const breakingHeader = match[2] === '!';
    const breakingFooter = /^BREAKING CHANGE: .+/m.test(commit.body);
    if (breakingHeader !== breakingFooter) {
      violations.push(
        commitConventionViolation(
          commit,
          'breaking changes require both ! in the header and a BREAKING CHANGE footer',
        ),
      );
    }
  }
  return violations;
};

const git = (repoRoot, args) =>
  childProcess.execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();

const revisionRange = (repoRoot, environment) => {
  const requested = environment.ASHFOX_COMMIT_BASE?.trim();
  if (requested && !ZERO_REVISION.test(requested)) {
    git(repoRoot, ['rev-parse', '--verify', `${requested}^{commit}`]);
    return `${requested}..HEAD`;
  }
  try {
    const base = git(repoRoot, ['merge-base', 'HEAD', 'origin/main']);
    if (base && base !== git(repoRoot, ['rev-parse', 'HEAD'])) {
      return `${base}..HEAD`;
    }
  } catch {
    // A local clone without origin/main still validates its current commit.
  }
  return 'HEAD';
};

const readCommits = (repoRoot, range) => {
  const field = '%H%x1f%s%x1f%b%x1e';
  const output = git(repoRoot, [
    'log',
    '--no-merges',
    ...(range === 'HEAD' ? ['-1'] : []),
    `--format=${field}`,
    range,
  ]);
  if (!output) return [];
  return output.split('\x1e').flatMap((record) => {
    const normalized = record.trim();
    if (!normalized) return [];
    const [hash = '', subject = '', body = ''] = normalized.split('\x1f');
    return [{ hash, subject, body }];
  });
};

const main = () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const manifest = readDevelopmentManifest(repoRoot);
  const range = revisionRange(repoRoot, process.env);
  const commits = readCommits(repoRoot, range);
  const violations = commitConventionViolations(manifest.workflow.commits, commits);
  if (violations.length > 0) {
    console.error(`commit convention gate failed for ${range}:`);
    for (const violation of violations) console.error(`- ${violation}`);
    process.exitCode = 1;
    return;
  }
  console.log(`commit convention gate ok: ${commits.length} non-merge commit(s) in ${range}`);
};

if (require.main === module) main();

module.exports = {
  commitConventionViolations,
  readCommits,
  revisionRange,
};
