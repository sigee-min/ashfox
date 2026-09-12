'use strict';

const fs = require('node:fs');
const path = require('node:path');

const defaultRepoRoot = path.resolve(__dirname, '..', '..');
const publicEngineRoot = (repoRoot) => path.resolve(repoRoot,
  'packages/engine-core/src');

const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

const scriptFiles = (repoRoot = defaultRepoRoot) => {
  const roots = ['scripts', 'apps'].map((name) => path.join(repoRoot, name));
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => compareText(left.name, right.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory() && !['dist', 'build', 'node_modules'].includes(entry.name)) visit(file);
      else if (entry.isFile() && file.endsWith('.js')) files.push(file);
    }
  };
  for (const root of roots) if (fs.existsSync(root)) visit(root);
  return files;
};

const importSpecifiers = (source) => {
  const values = [];
  const pattern = /(?:\bfrom\s+|\brequire\s*\(|\bimport\s*(?:\(\s*)?)['"]([^'"]+)['"]/g;
  let match;
  while ((match = pattern.exec(source)) !== null) values.push(match[1]);
  return values;
};

const isPrivateEngineSpecifier = (file, specifier, repoRoot) => {
  if (!specifier.startsWith('.')) return false;
  const sourceRoot = publicEngineRoot(repoRoot);
  const target = path.resolve(path.dirname(file), specifier)
    .replace(/\.(?:js|jsx|ts|tsx)$/u, '');
  return target.startsWith(`${sourceRoot}${path.sep}`) &&
    target !== path.join(sourceRoot, 'index');
};

const privateEngineImportViolations = ({
  repoRoot = defaultRepoRoot,
  files = scriptFiles(repoRoot)
} = {}) => {
  return files.flatMap((file) => {
    const source = fs.readFileSync(file, 'utf8');
    return importSpecifiers(source)
      .filter((specifier) => isPrivateEngineSpecifier(file, specifier, repoRoot))
      .map((specifier) => ({
        file: path.relative(repoRoot, file).replace(/\\/g, '/'),
        specifier
      }));
  });
};

const main = () => {
  const violations = privateEngineImportViolations();
  if (violations.length === 0) {
    console.log(
      'ashfox script architecture gate ok: private engine imports 0'
    );
    return;
  }
  for (const violation of violations) console.error(
    `script architecture: ${violation.file} imports private engine module ` +
    `${violation.specifier}; use the public engine barrel`
  );
  process.exitCode = 1;
};

if (require.main === module) main();

module.exports = Object.freeze({
  importSpecifiers,
  privateEngineImportViolations,
  scriptFiles
});
