'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readDevelopmentManifest } = require('./manifest');
const {
  REQUIRED_SECTIONS,
  branchNameViolations,
  parseCliArgs,
  parseSections,
  prBodyViolations,
  pullRequestViolations,
} = require('./prCheck');

const repoRoot = path.resolve(__dirname, '..', '..');
const policy = readDevelopmentManifest(repoRoot).workflow.commits;

const validBody = [
  '## Summary',
  '',
  '- Add pull request check validator and template.',
  '',
  '## Scope & Impact',
  '',
  '- **Changed areas**: `scripts/quality`, `.github/`',
  '- **External contracts / compiled outputs**: Unchanged (`quality:products` ok)',
  '- **Breaking change**: None',
  '- **Rollback**: Safe to revert squash commit',
  '',
  '## Verification',
  '',
  '- [x] `npm run quality:check`',
  '- [x] `npm run quality:products`',
  '- [x] `npm run quality`',
  '',
  '## Review Checklist',
  '',
  '- [x] Single mutation authority preserved.',
  '- [x] Stateful paths terminate cleanly.',
  '',
].join('\n');

assert.deepEqual(
  pullRequestViolations({
    policy,
    title: 'chore(repo): establish pr-centric workflow and agent skills',
    body: validBody,
    branch: 'chore/pr-workflow-conventions',
    draft: false,
  }),
  [],
);

// Title validation via manifest commit policy
for (const badTitle of [
  'missing type',
  'feat: Capitalized subject',
  'fix: fixed bug',
  'chore: add check.',
]) {
  assert.ok(
    pullRequestViolations({
      policy,
      title: badTitle,
      body: validBody,
      branch: 'feat/add-check',
    }).length > 0,
    `expected invalid title: ${badTitle}`,
  );
}

// Breaking change coupling between ! and BREAKING CHANGE footer
assert.ok(
  pullRequestViolations({
    policy,
    title: 'feat!: break output format',
    body: validBody,
    branch: 'feat/break-output',
  }).length > 0,
);
assert.ok(
  pullRequestViolations({
    policy,
    title: 'feat: regular title',
    body: `${validBody}\nBREAKING CHANGE: alters CLI JSON.\n`,
    branch: 'feat/break-output',
  }).length > 0,
);
assert.deepEqual(
  pullRequestViolations({
    policy,
    title: 'feat!: break output format',
    body: `${validBody}\nBREAKING CHANGE: alters CLI JSON.\n`,
    branch: 'feat/break-output',
  }),
  [],
);

// Branch naming rules
for (const validBranch of ['feat/add-check', 'chore/pr-workflow-conventions', 'fix/a']) {
  assert.deepEqual(branchNameViolations(validBranch, policy.types), []);
}
for (const invalidBranch of [
  'main',
  'feature/foo',
  'feat/Upper',
  'feat/bad_slug',
  'feat/-bad',
  'feat/bad-',
]) {
  assert.ok(
    branchNameViolations(invalidBranch, policy.types).length > 0,
    `expected invalid branch: ${invalidBranch}`,
  );
}

// Missing sections & comment-only placeholders
assert.ok(prBodyViolations('## Summary\n\nFilled.\n').length >= 3);

const templatePath = path.join(repoRoot, '.github', 'PULL_REQUEST_TEMPLATE.md');
const templateBody = fs.readFileSync(templatePath, 'utf8');
const templateSections = parseSections(templateBody);
for (const heading of REQUIRED_SECTIONS) {
  assert.ok(templateSections.has(heading), `template missing section: ${heading}`);
}

// Unmodified template must fail both empty section and unchecked checklist rules on non-draft PRs
const templateViolations = prBodyViolations(templateBody, { draft: false });
assert.ok(templateViolations.some((v) => v.includes('## Summary')));
assert.ok(templateViolations.some((v) => v.includes('## Scope & Impact')));
assert.ok(templateViolations.some((v) => v.includes('unchecked checklist item')));

// Draft PRs allow unchecked checklists as long as sections are populated
const draftBody = validBody.replaceAll('- [x]', '- [ ]');
assert.ok(prBodyViolations(draftBody, { draft: false }).length > 0);
assert.deepEqual(prBodyViolations(draftBody, { draft: true }), []);

// Automated branches
assert.deepEqual(
  pullRequestViolations({
    policy,
    title: 'chore(main): release 2.1.0',
    body: 'Auto-generated release-please body.',
    branch: 'release-please--branches--main--components--ashfox',
  }),
  [],
);
assert.deepEqual(
  pullRequestViolations({
    policy,
    title: 'docs(install): advance verified stable downloads',
    body: 'Auto-generated stable promotion.',
    branch: 'release/stable-downloads',
  }),
  [],
);
assert.deepEqual(
  pullRequestViolations({
    policy,
    title: 'Bump esbuild from 0.28.0 to 0.28.1',
    body: '',
    branch: 'dependabot/npm_and_yarn/esbuild-0.28.1',
  }),
  [],
);

// GITHUB_EVENT_PATH parsing
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-pr-check-'));
try {
  const eventPath = path.join(tmpDir, 'event.json');
  fs.writeFileSync(
    eventPath,
    JSON.stringify({
      pull_request: {
        title: 'fix(cli): handle empty input',
        body: validBody,
        head: { ref: 'fix/empty-input' },
        draft: true,
      },
    }),
  );
  assert.deepEqual(parseCliArgs([], { GITHUB_EVENT_PATH: eventPath }), {
    title: 'fix(cli): handle empty input',
    body: validBody,
    branch: 'fix/empty-input',
    draft: true,
  });
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log('ashfox pr check fixture tests ok');
