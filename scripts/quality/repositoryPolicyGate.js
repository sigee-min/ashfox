'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { compareText, readJson } = require('../shared');

const readModuleSpecifiers = (source) => {
  const specifiers = [];
  const pattern = /(?:\bfrom\s+|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    specifiers.push(match[1]);
  }
  return specifiers;
};

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

const tombstoneViolations = (tombstones, exists) =>
  tombstones
    .filter((tombstone) => exists(tombstone))
    .map((tombstone) => `quality: removed boundary restored: ${tombstone}`);

const workspacePolicyViolations = (workspaces, policy) => {
  const actual = new Set(workspaces);
  const violations = [];
  for (const workspace of policy.forbidden) {
    if (actual.has(workspace)) {
      violations.push(`quality: forbidden workspace restored: ${workspace}`);
    }
  }
  for (const workspace of policy.required) {
    if (!actual.has(workspace)) {
      violations.push(`quality: required workspace is missing: ${workspace}`);
    }
  }
  return violations;
};

const dependencyNames = (packageManifest, sections) => {
  const names = new Set();
  for (const section of sections) {
    const dependencies = packageManifest[section];
    if (!dependencies || typeof dependencies !== 'object') continue;
    for (const name of Object.keys(dependencies)) names.add(name);
  }
  return [...names].sort();
};

const dependencyPolicyViolations = (packageManifests, policies) => {
  const violations = [];
  for (const policy of policies) {
    const packageManifest = packageManifests.get(policy.workspace);
    if (!packageManifest) {
      violations.push(`quality: package manifest is missing for ${policy.workspace}`);
      continue;
    }
    const dependencies = dependencyNames(packageManifest, policy.sections);
    if (policy.mode === 'allow-only') {
      const allowed = new Set(policy.values);
      for (const dependency of dependencies) {
        if (!allowed.has(dependency)) {
          violations.push(`quality: ${policy.workspace} cannot depend on ${dependency}`);
        }
      }
      continue;
    }
    for (const dependency of dependencies) {
      const normalized = dependency.toLowerCase();
      if (policy.values.some((prefix) => normalized.startsWith(prefix.toLowerCase()))) {
        violations.push(`quality: ${policy.workspace} cannot depend on ${dependency}`);
      }
    }
  }
  return violations;
};

const externalImportForbidden = (specifier, boundary) => {
  if (boundary.allowedExternalImports.includes(specifier)) return false;
  if (boundary.forbiddenExternalPrefixes.some((prefix) => specifier.startsWith(prefix))) {
    return true;
  }
  return boundary.forbiddenExternalPackageRoots.some(
    (root) => specifier === root || specifier.startsWith(`${root}/`),
  );
};

const importBoundaryViolations = ({ repoRoot, filePath, specifiers, boundary }) => {
  const violations = [];
  for (const specifier of specifiers) {
    if (!specifier.startsWith('.')) {
      if (externalImportForbidden(specifier, boundary)) {
        violations.push(
          `quality: ${boundary.source} crosses product boundary in ` +
            `${path.relative(repoRoot, filePath).replace(/\\/g, '/')}: ` +
            specifier,
        );
      }
      continue;
    }
    const targetPath = path.resolve(path.dirname(filePath), specifier);
    if (
      boundary.forbiddenRelativeTargets.some((prefix) => {
        const forbiddenRoot = path.resolve(repoRoot, prefix);
        return targetPath === forbiddenRoot || targetPath.startsWith(`${forbiddenRoot}${path.sep}`);
      })
    ) {
      violations.push(
        `quality: ${boundary.source} crosses product boundary in ` +
          path.relative(repoRoot, filePath).replace(/\\/g, '/'),
      );
    }
  }
  return violations;
};

const repositoryPolicyViolations = (repoRoot, architecture) => {
  const violations = tombstoneViolations(architecture.tombstones, (tombstone) =>
    fs.existsSync(path.join(repoRoot, tombstone)),
  );

  const rootPackage = readJson(path.join(repoRoot, 'package.json'));
  violations.push(
    ...workspacePolicyViolations(rootPackage.workspaces ?? [], architecture.workspacePolicy),
  );

  const packageManifests = new Map(
    architecture.packageDependencyPolicies.map((policy) => [
      policy.workspace,
      readJson(path.join(repoRoot, policy.workspace, 'package.json')),
    ]),
  );
  violations.push(
    ...dependencyPolicyViolations(packageManifests, architecture.packageDependencyPolicies),
  );

  for (const boundary of architecture.sourceImportBoundaries) {
    const extensions = new Set(boundary.extensions);
    const sourceFiles = walk(path.join(repoRoot, boundary.source), (filePath) =>
      extensions.has(path.extname(filePath)),
    );
    for (const filePath of sourceFiles) {
      violations.push(
        ...importBoundaryViolations({
          repoRoot,
          filePath,
          specifiers: readModuleSpecifiers(fs.readFileSync(filePath, 'utf8')),
          boundary,
        }),
      );
    }
  }
  return violations;
};

module.exports = {
  dependencyPolicyViolations,
  importBoundaryViolations,
  repositoryPolicyViolations,
  tombstoneViolations,
  workspacePolicyViolations,
};
