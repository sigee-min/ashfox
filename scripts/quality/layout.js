'use strict';

const fs = require('node:fs');
const path = require('node:path');

const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

const ownerCodeFiles = (workspace) =>
  ['src', 'tests', 'testSupport']
    .map((name) => path.join(workspace.directory, name))
    .filter((directory) => fs.existsSync(directory))
    .flatMap((root) => {
      const files = [];
      const visit = (directory) => {
        const entries = fs
          .readdirSync(directory, { withFileTypes: true })
          .sort((left, right) => compareText(left.name, right.name));
        for (const entry of entries) {
          const value = path.join(directory, entry.name);
          if (entry.isDirectory()) visit(value);
          else if (/\.(?:[cm]?js|tsx?)$/.test(value)) files.push(value);
        }
      };
      visit(root);
      return files;
    });

const codeFileStem = (file) => path.basename(file).replace(/(\.test)?\.(?:[cm]?js|tsx?)$/, '');

const codeFileStemViolations = (files, maximumLength) =>
  files
    .map((file) => ({ file, stem: codeFileStem(file) }))
    .filter(({ stem }) => stem.length > maximumLength)
    .map(({ file, stem }) => ({
      file,
      length: stem.length,
      maximumLength,
    }));

const testFileLineViolations = (files, maximumLines) =>
  files
    .filter(({ file }) => file.replace(/\\/g, '/').endsWith('.test.ts'))
    .filter(({ lines }) => lines > maximumLines)
    .map(({ file, lines }) => ({ file, lines, maximumLines }));

const ownerContractViolations = (files, expectedBasename) =>
  files.flatMap((file) => {
    const stem = codeFileStem(file);
    const pathSegments = file.replace(/\\/g, '/').split('/');
    const ownerRoot = Math.max(
      pathSegments.lastIndexOf('src'),
      pathSegments.lastIndexOf('tests'),
      pathSegments.lastIndexOf('testSupport'),
    );
    const ownerSegments = pathSegments.slice(ownerRoot + 1, -1);
    const repeatedOwner = ownerSegments.find(
      (segment) => segment !== expectedBasename && /contracts?$/i.test(segment),
    );
    if (repeatedOwner) {
      return [
        {
          file,
          reason: `contract owner directory repeats its role: ${repeatedOwner}`,
        },
      ];
    }
    return stem !== expectedBasename && /contracts?$/i.test(stem)
      ? [
          {
            file,
            reason: `contract files must be named ${expectedBasename}`,
          },
        ]
      : [];
  });

const normalizedOwnerName = (value) => value.replace(/[^a-z0-9]/gi, '').toLowerCase();

const testLayoutViolations = (files, policy) =>
  files.flatMap((file) => {
    const canonical = file.replace(/\\/g, '/');
    const segments = canonical.split('/');
    const testsIndex = segments.lastIndexOf('tests');
    const testMatch = canonical.match(/\.test\.(?:tsx?|[cm]?js)$/);
    if (testsIndex < 0) return [];

    const ownedPath = segments.slice(testsIndex + 1);
    const stem = codeFileStem(file);
    const findings = [];
    const workspace = segments.slice(0, testsIndex).join('/');
    const declaredOwner = policy.testOwners.find((entry) => entry.workspace === workspace);
    if (testMatch) {
      if (!canonical.endsWith(`${policy.testFileSuffix}${policy.testFileExtension}`)) {
        findings.push({
          file,
          reason: `test files must use ${policy.testFileSuffix}` + `${policy.testFileExtension}`,
        });
      }
      if (ownedPath.length < 2) {
        findings.push({ file, reason: 'test must live under an owner directory' });
      } else if (!declaredOwner || !declaredOwner.roots.includes(ownedPath[0])) {
        findings.push({
          file,
          reason: `undeclared test owner: ${ownedPath[0]}`,
        });
      }
    }
    if (stem.length > policy.maxTestFileStemLength) {
      findings.push({
        file,
        reason:
          `test stem has ${stem.length} characters ` + `(max ${policy.maxTestFileStemLength})`,
      });
    }
    if (policy.testFileStem === 'lower-word' && !/^[a-z][a-z0-9]*$/.test(stem)) {
      findings.push({
        file,
        reason: 'test stem must be one lowercase word',
      });
    }
    if (ownedPath.length >= 2) {
      const owner = normalizedOwnerName(ownedPath.at(-2));
      const normalizedStem = normalizedOwnerName(stem);
      if (owner.length > 0 && normalizedStem !== owner && normalizedStem.startsWith(owner)) {
        findings.push({
          file,
          reason: `test stem repeats owner prefix: ${ownedPath.at(-2)}`,
        });
      }
    }
    return findings;
  });

module.exports = {
  codeFileStemViolations,
  ownerCodeFiles,
  ownerContractViolations,
  testFileLineViolations,
  testLayoutViolations,
};
