const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const textCompare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

const sourceFiles = (root) => {
  const files = [];
  const visit = (directory) => {
    const entries = fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => textCompare(left.name, right.name));
    for (const entry of entries) {
      const value = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(value);
      else if (/\.tsx?$/.test(value)) files.push(value);
    }
  };
  visit(root);
  return files;
};

const importSpecifiers = (source) => {
  const values = [];
  const pattern = /(?:\bfrom\s+|\bimport\s*(?:\(\s*)?)['"]([^'"]+)['"]/g;
  let match;
  while ((match = pattern.exec(source)) !== null) values.push(match[1]);
  return values;
};

const resolveImport = (fromFile, specifier, knownFiles, compilerOptions) => {
  if (specifier.startsWith('.')) {
    const base = path.resolve(path.dirname(fromFile), specifier);
    return (
      [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')].find(
        (candidate) => knownFiles.has(candidate),
      ) ?? null
    );
  }
  const resolved = ts.resolveModuleName(specifier, fromFile, compilerOptions, ts.sys).resolvedModule
    ?.resolvedFileName;
  if (!resolved) return null;
  const target = path.resolve(resolved);
  return knownFiles.has(target) ? target : null;
};

const dependencyGraph = (files, sources, compilerOptions = {}) => {
  const knownFiles = new Set(files);
  return new Map(
    files.map((file) => [
      file,
      importSpecifiers(sources.get(file))
        .map((specifier) => resolveImport(file, specifier, knownFiles, compilerOptions))
        .filter((target) => target !== null),
    ]),
  );
};

const reachableFiles = (graph, roots) => {
  const reached = new Set();
  const pending = [...roots].sort(textCompare).reverse();
  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || reached.has(file) || !graph.has(file)) continue;
    reached.add(file);
    const targets = [...graph.get(file)].sort(textCompare).reverse();
    pending.push(...targets);
  }
  return reached;
};

module.exports = {
  dependencyGraph,
  importSpecifiers,
  reachableFiles,
  sourceFiles,
};
