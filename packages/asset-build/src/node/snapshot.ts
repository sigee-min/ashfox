import * as fs from 'node:fs';
import * as path from 'node:path';
import { isDirectorySource, readDirectoryWorkspace, matchDirectoryPattern } from '@ashfox/engine-core';
import { BuildFailure, type Snapshot } from '../contract';
import { digest, json } from '../digest';
import { contained, noLinks, safeRelative } from './paths';
import { evaluateConfiguration } from './configuration';
import { readStandalone } from './standalone';

const readText = (file: string, limit: number): string => {
  noLinks(file); const before = fs.statSync(file);
  if (!before.isFile() || before.size > limit) throw new BuildFailure('source.budget', file);
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const bytes = fs.readFileSync(descriptor), after = fs.fstatSync(descriptor);
    if (bytes.length > limit || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new BuildFailure('source.changed', file);
    }
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } finally { fs.closeSync(descriptor); }
};
export const readSnapshot = (input: string): Snapshot => {
  const requested = path.resolve(input);
  const selectedFile = path.join(fs.realpathSync(path.dirname(requested)), path.basename(requested));
  let file = selectedFile;
  noLinks(file);
  if (!fs.statSync(file).isFile()) throw new BuildFailure('source.file', 'Expected a source or configuration file', 2);
  if (file.endsWith('.ashfox')) {
    let directory = path.dirname(file);
    while (true) {
      const candidates = ['.ashfoxworkspace', '.ashfoxworkspace.mjs'].map(name => path.join(directory, name)).filter(candidate => fs.existsSync(candidate));
      if (candidates.length > 1) throw new BuildFailure('workspace.ambiguous', 'Keep one workspace configuration per root', 2);
      if (candidates.length) { file = candidates[0]; break; }
      if (fs.existsSync(path.join(directory, '.git')) || path.dirname(directory) === directory) {
        return readStandalone(file, readText);
      }
      directory = path.dirname(directory);
    }
  }
  if (!['.ashfoxworkspace', '.ashfoxworkspace.mjs'].includes(path.basename(file))) throw new BuildFailure('workspace.filename', 'Expected .ashfox source, .ashfoxworkspace or .ashfoxworkspace.mjs', 2);
  const root = fs.realpathSync(path.dirname(file));
  const alternatives = ['.ashfoxworkspace', '.ashfoxworkspace.mjs'].filter(name => fs.existsSync(path.join(root, name)));
  if (alternatives.length > 1) throw new BuildFailure('workspace.ambiguous', 'Keep one workspace configuration per root', 2);
  noLinks(file);
  if (!fs.statSync(file).isFile()) throw new BuildFailure('source.file', 'Expected a configuration file', 2);
  const configuration = file.endsWith('.mjs') ? evaluateConfiguration(file) : readText(file, 262144);
  let config: Snapshot['config'];
  try { config = readDirectoryWorkspace(configuration); }
  catch (error) { throw new BuildFailure('workspace.config', error instanceof Error ? error.message : String(error), 2); }
  if (input.endsWith('.ashfox')) {
    const relative = path.relative(root, selectedFile).split(path.sep).join('/');
    const declared = config.packages.some(pkg => pkg.manifest.entries.some(entry =>
      [pkg.root, entry.path].filter(Boolean).join('/') === relative));
    if (!declared || !isDirectorySource(config, relative)) {
      throw new BuildFailure('source.entry', 'Source is not an included entry in the repository configuration: ' + relative, 2);
    }
  }
  const excluded = ['.git', 'node_modules', '.ashfox', config.build.directory, ...config.exports.map(e => e.directory), ...(config.packs ?? []).map(p => p.directory)];
  excluded.forEach(directory => { if (directory !== '.git') noLinks(contained(root, directory)); });
  const files: { path: string; source: string }[] = [];
  let visited = 0, total = 0;
  const visit = (relative: string): void => {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const next = relative ? `${relative}/${entry.name}` : entry.name;
      if (++visited > 20000) throw new BuildFailure('source.budget', 'Directory scan exceeds 20000 entries');
      if (excluded.some(prefix => next === prefix || next.startsWith(prefix + '/')) ||
        config.ignore.some(glob => glob.endsWith('/**') && matchDirectoryPattern(next, glob.slice(0, -3)))) continue;
      if (!safeRelative(next)) throw new BuildFailure('source.path', next);
      if (entry.isSymbolicLink()) throw new BuildFailure('source.symlink', next);
      if (entry.isDirectory()) visit(next);
      else if (isDirectorySource(config, next)) {
        const source = readText(contained(root, next), 8 * 1024 * 1024);
        total += Buffer.byteLength(source);
        if (total > 8 * 1024 * 1024 || files.length >= 512) throw new BuildFailure('source.budget', 'Source budget exceeded');
        files.push({ path: next, source });
      }
    }
  };
  visit('');
  return { input: selectedFile, root, configuration, config, files, hash: digest(json({ configuration, files })) };
};
export const assertSnapshot = (snapshot: Snapshot): void => {
  if (readSnapshot(snapshot.input).hash !== snapshot.hash) {
    throw new BuildFailure('source.changed', 'Source changed during compilation');
  }
};

/** Observation deliberately ignores ancestor build configuration. */
export const readSingleSnapshot = (input: string): Snapshot => readStandalone(path.resolve(input), readText);
