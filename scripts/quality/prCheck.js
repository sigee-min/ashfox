'use strict';

/**
 * Pull request metadata and template gate: enforces conventional titles via the
 * development manifest, <type>/<short-slug> branches, and populated PR
 * template sections/checklists. Uses Node built-ins only so CI runs without npm ci.
 */
const fs = require('node:fs');
const path = require('node:path');

const { commitConventionViolations } = require('./commitConvention');
const { readDevelopmentManifest } = require('./manifest');

const REQUIRED_SECTIONS = Object.freeze([
  'Summary',
  'Scope & Impact',
  'Verification',
  'Review Checklist',
]);
const CHECKLIST_SECTIONS = Object.freeze(['Verification', 'Review Checklist']);
const BOT_BRANCH_PATTERN = /^(?:dependabot|renovate)\//;
const RELEASE_BRANCH_PATTERN = /^(?:release-please--|release\/)/;

const stripHtmlComments = (text) => String(text ?? '').replace(/<!--[\s\S]*?-->/g, '');

const branchNameViolations = (branch, allowedTypes) => {
  if (!branch) return [];
  if (branch === 'main') {
    return ['pr branch must not be main'];
  }
  if (BOT_BRANCH_PATTERN.test(branch) || RELEASE_BRANCH_PATTERN.test(branch)) {
    return [];
  }
  const pattern = new RegExp(`^(${allowedTypes.join('|')})/[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$`);
  if (!pattern.test(branch)) {
    return [
      `pr branch ${JSON.stringify(branch)}: expected <type>/<short-slug> ` +
        `with type in [${allowedTypes.join(', ')}] and lowercase kebab-case slug`,
    ];
  }
  return [];
};

const parseSections = (body) => {
  const sections = new Map();
  const lines = String(body ?? '').split(/\r?\n/);
  let current = null;
  let buffer = [];
  for (const line of lines) {
    const match = line.match(/^##\s+(.+?)\s*$/);
    if (match) {
      if (current !== null) sections.set(current, buffer.join('\n'));
      current = match[1].trim();
      buffer = [];
    } else if (current !== null) {
      buffer.push(line);
    }
  }
  if (current !== null) sections.set(current, buffer.join('\n'));
  return sections;
};

const hasScopeContent = (text) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => {
      if (!line) return false;
      const colon = line.indexOf(':');
      return colon >= 0 ? line.slice(colon + 1).trim().length > 0 : true;
    });

const prBodyViolations = (body, { draft = false } = {}) => {
  const sections = parseSections(body);
  const violations = [];
  for (const heading of REQUIRED_SECTIONS) {
    if (!sections.has(heading)) {
      violations.push(`pr body is missing required section "## ${heading}"`);
      continue;
    }
    const clean = stripHtmlComments(sections.get(heading)).trim();
    if (!clean || (heading === 'Scope & Impact' && !hasScopeContent(clean))) {
      violations.push(`pr body section "## ${heading}" must not be empty`);
    }
  }
  if (!draft) {
    for (const heading of CHECKLIST_SECTIONS) {
      if (!sections.has(heading)) continue;
      const section = stripHtmlComments(sections.get(heading));
      if (!/^\s*-\s+\[[xX]\]\s+\S/m.test(section)) {
        violations.push(`pr body section "## ${heading}" must have at least one checked item`);
      }
      if (/^\s*-\s+\[\s\]/m.test(section)) {
        violations.push(`pr body section "## ${heading}" has unchecked checklist item(s)`);
      }
    }
  }
  return violations;
};

const pullRequestViolations = ({ policy, title, body = '', branch = '', draft = false }) => {
  if (branch && BOT_BRANCH_PATTERN.test(branch)) return [];
  const titleViolations = commitConventionViolations(policy, [
    { hash: 'PR', subject: String(title ?? ''), body: String(body ?? '') },
  ]);
  if (branch && RELEASE_BRANCH_PATTERN.test(branch)) {
    return titleViolations;
  }
  return [
    ...titleViolations,
    ...branchNameViolations(branch, policy.types),
    ...prBodyViolations(body, { draft }),
  ];
};

const readValueFlag = (argv, index, flag) => {
  if (index + 1 >= argv.length) {
    throw new Error(`Missing value for ${flag}`);
  }
  return argv[index + 1];
};

const parseCliArgs = (argv, env = process.env) => {
  let title;
  let body;
  let bodyFile;
  let branch;
  let draft = false;
  let hasFlag = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--title') {
      title = readValueFlag(argv, index, arg);
      index += 1;
      hasFlag = true;
    } else if (arg === '--body') {
      body = readValueFlag(argv, index, arg);
      index += 1;
      hasFlag = true;
    } else if (arg === '--body-file') {
      bodyFile = readValueFlag(argv, index, arg);
      index += 1;
      hasFlag = true;
    } else if (arg === '--branch') {
      branch = readValueFlag(argv, index, arg);
      index += 1;
      hasFlag = true;
    } else if (arg === '--draft') {
      draft = true;
      hasFlag = true;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (hasFlag) {
    const resolvedBody = bodyFile ? fs.readFileSync(bodyFile, 'utf8') : (body ?? '');
    if (title === undefined) {
      throw new Error('Missing required --title');
    }
    return { title, body: resolvedBody, branch: branch ?? '', draft };
  }

  const eventPath = env.GITHUB_EVENT_PATH;
  if (eventPath && fs.existsSync(eventPath)) {
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
    if (event.pull_request) {
      return {
        title: event.pull_request.title ?? '',
        body: event.pull_request.body ?? '',
        branch: event.pull_request.head?.ref ?? '',
        draft: Boolean(event.pull_request.draft),
      };
    }
  }

  return null;
};

const main = () => {
  let input;
  try {
    input = parseCliArgs(process.argv.slice(2), process.env);
  } catch (error) {
    console.error(`prCheck: ${error.message}`);
    process.exitCode = 2;
    return;
  }
  if (!input) {
    console.error(
      'Usage: node scripts/quality/prCheck.js --title <title> [--body <text> | --body-file <path>] [--branch <ref>] [--draft] (or set GITHUB_EVENT_PATH)',
    );
    process.exitCode = 2;
    return;
  }

  const repoRoot = path.resolve(__dirname, '..', '..');
  const manifest = readDevelopmentManifest(repoRoot);
  const violations = pullRequestViolations({
    policy: manifest.workflow.commits,
    ...input,
  });
  if (violations.length > 0) {
    console.error('pr check failed:');
    for (const violation of violations) console.error(`- ${violation}`);
    process.exitCode = 1;
    return;
  }
  console.log(`pr check ok: ${input.title}${input.draft ? ' (draft)' : ''}`);
};

if (require.main === module) main();

module.exports = Object.freeze({
  BOT_BRANCH_PATTERN,
  CHECKLIST_SECTIONS,
  RELEASE_BRANCH_PATTERN,
  REQUIRED_SECTIONS,
  branchNameViolations,
  parseCliArgs,
  parseSections,
  prBodyViolations,
  pullRequestViolations,
  stripHtmlComments,
});
