/* eslint-disable no-console */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { compareText } = require('../shared');
const { readDevelopmentManifest } = require('./manifest');
const { repositoryPolicyViolations } = require('./repositoryPolicyGate');
const { assertSourcePatternRegistryMatches, sourcePatternFindings } = require('./patterns');

const repoRoot = path.resolve(__dirname, '..', '..');
const developmentManifest = readDevelopmentManifest(repoRoot);

const readText = (filePath) => fs.readFileSync(filePath, 'utf8');

const walk = (directory, predicate) => {
  const files = [];
  const entries = fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => compareText(left.name, right.name));
  for (const entry of entries) {
    const value = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      files.push(...walk(value, predicate));
    } else if (predicate(value)) {
      files.push(value);
    }
  }
  return files;
};

const relativePath = (filePath) => path.relative(repoRoot, filePath).replace(/\\/g, '/');

const workspaceSourceDirectories = () =>
  developmentManifest.architecture.workspaceSourceScopes.flatMap((scope) =>
    fs
      .readdirSync(path.join(repoRoot, scope), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => compareText(left.name, right.name))
      .map((entry) => path.join(repoRoot, scope, entry.name))
      .filter(
        (directory) =>
          fs.existsSync(path.join(directory, 'package.json')) &&
          fs.existsSync(path.join(directory, 'src')),
      )
      .map((directory) => path.join(directory, 'src')),
  );

const main = () => {
  const repositoryViolations = repositoryPolicyViolations(
    repoRoot,
    developmentManifest.architecture,
  );
  if (repositoryViolations.length > 0) {
    throw new Error(repositoryViolations[0]);
  }

  const sourcePolicies = developmentManifest.quality.forbiddenSourcePatterns;
  assertSourcePatternRegistryMatches(sourcePolicies);
  const sourceDirectories = workspaceSourceDirectories();
  const sourceFiles = sourceDirectories.flatMap((directory) =>
    walk(directory, (filePath) => filePath.endsWith('.ts') || filePath.endsWith('.tsx')),
  );

  const findings = [];
  for (const filePath of sourceFiles) {
    const source = readText(filePath);
    findings.push(
      ...sourcePatternFindings(filePath, relativePath(filePath), source, sourcePolicies),
    );
  }

  if (findings.length > 0) {
    console.error('ashfox quality gate failed. Violations:');
    for (const finding of findings) {
      console.error(`- ${finding.rule}: ${finding.file}:${finding.line} :: ` + finding.snippet);
    }
    process.exitCode = 1;
    return;
  }

  console.log('ashfox quality gate ok');
};

if (require.main === module) main();
