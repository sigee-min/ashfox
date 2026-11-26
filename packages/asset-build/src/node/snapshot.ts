import { compareText } from '@ashfox/internal-contracts';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  isDirectorySource,
  readDirectoryWorkspace,
  matchDirectoryPattern,
} from '@ashfox/engine-core';
import { BuildFailure, type Snapshot } from '../bundle/contract';
import { digest, json } from '../shared/digest';
import { contained, noLinks, safeRelative } from './paths';
import { evaluateConfiguration } from './configuration';
import { readStandalone } from './standalone';

const STRICT_UTF8_DECODER = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

const readText = (file: string, limit: number): string => {
  noLinks(file);
  const before = fs.statSync(file);
  if (!before.isFile() || before.size > limit) throw new BuildFailure('source.budget', file);
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const bytes = fs.readFileSync(descriptor),
      after = fs.fstatSync(descriptor);
    if (
      bytes.length > limit ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    ) {
      throw new BuildFailure('source.changed', file);
    }
    return STRICT_UTF8_DECODER.decode(bytes);
  } finally {
    fs.closeSync(descriptor);
  }
};
type WorkspaceConfigResolution =
  | { readonly kind: 'standalone'; readonly snapshot: Snapshot }
  | { readonly kind: 'config'; readonly file: string };

const resolveWorkspaceConfigFile = (selectedFile: string): WorkspaceConfigResolution => {
  let file = selectedFile;
  noLinks(file);
  if (!fs.statSync(file).isFile())
    throw new BuildFailure('source.file', 'Expected a source or configuration file', 2);
  if (file.endsWith('.ashfox')) {
    let directory = path.dirname(file);
    while (true) {
      const candidates = ['.ashfoxworkspace', '.ashfoxworkspace.mjs']
        .map((name) => path.join(directory, name))
        .filter((candidate) => fs.existsSync(candidate));
      if (candidates.length > 1)
        throw new BuildFailure(
          'workspace.ambiguous',
          'Keep one workspace configuration per root',
          2,
        );
      if (candidates.length) {
        file = candidates[0];
        break;
      }
      if (fs.existsSync(path.join(directory, '.git')) || path.dirname(directory) === directory)
        return { kind: 'standalone', snapshot: readStandalone(file, readText) };
      directory = path.dirname(directory);
    }
  }
  if (!['.ashfoxworkspace', '.ashfoxworkspace.mjs'].includes(path.basename(file)))
    throw new BuildFailure(
      'workspace.filename',
      'Expected .ashfox source, .ashfoxworkspace or .ashfoxworkspace.mjs',
      2,
    );
  return { kind: 'config', file };
};

const loadWorkspaceConfig = (
  file: string,
): { root: string; configuration: string; config: Snapshot['config'] } => {
  const root = fs.realpathSync(path.dirname(file));
  const alternatives = ['.ashfoxworkspace', '.ashfoxworkspace.mjs'].filter((name) =>
    fs.existsSync(path.join(root, name)),
  );
  if (alternatives.length > 1)
    throw new BuildFailure('workspace.ambiguous', 'Keep one workspace configuration per root', 2);
  noLinks(file);
  if (!fs.statSync(file).isFile())
    throw new BuildFailure('source.file', 'Expected a configuration file', 2);
  const configuration = file.endsWith('.mjs')
    ? evaluateConfiguration(file)
    : readText(file, 262144);
  try {
    return { root, configuration, config: readDirectoryWorkspace(configuration) };
  } catch (error) {
    throw new BuildFailure(
      'workspace.config',
      error instanceof Error ? error.message : String(error),
      2,
    );
  }
};

const assertEntryIncluded = (
  config: Snapshot['config'],
  root: string,
  selectedFile: string,
): void => {
  const relative = path.relative(root, selectedFile).split(path.sep).join('/');
  const declared = config.packages.some((pkg) =>
    pkg.manifest.entries.some(
      (entry) => [pkg.root, entry.path].filter(Boolean).join('/') === relative,
    ),
  );
  if (!declared || !isDirectorySource(config, relative)) {
    throw new BuildFailure(
      'source.entry',
      'Source is not an included entry in the repository configuration: ' + relative,
      2,
    );
  }
};

interface WorkspaceScanState {
  readonly root: string;
  readonly config: Snapshot['config'];
  readonly excluded: readonly string[];
  readonly files: { path: string; source: string }[];
  visited: number;
  total: number;
}

const isIgnoredScanPath = (
  next: string,
  excluded: readonly string[],
  ignore: readonly string[],
): boolean =>
  excluded.some((prefix) => next === prefix || next.startsWith(prefix + '/')) ||
  ignore.some((glob) => glob.endsWith('/**') && matchDirectoryPattern(next, glob.slice(0, -3)));

const appendWorkspaceSourceFile = (state: WorkspaceScanState, next: string): void => {
  const source = readText(contained(state.root, next), 8 * 1024 * 1024);
  state.total += Buffer.byteLength(source);
  if (state.total > 8 * 1024 * 1024 || state.files.length >= 512)
    throw new BuildFailure('source.budget', 'Source budget exceeded');
  state.files.push({ path: next, source });
};

const visitWorkspaceEntry = (
  state: WorkspaceScanState,
  relative: string,
  entry: fs.Dirent,
): void => {
  const next = relative ? `${relative}/${entry.name}` : entry.name;
  if (++state.visited > 20000)
    throw new BuildFailure('source.budget', 'Directory scan exceeds 20000 entries');
  if (isIgnoredScanPath(next, state.excluded, state.config.ignore)) return;
  if (!safeRelative(next)) throw new BuildFailure('source.path', next);
  if (entry.isSymbolicLink()) throw new BuildFailure('source.symlink', next);
  if (entry.isDirectory()) visitWorkspaceDirectory(state, next);
  else if (isDirectorySource(state.config, next)) appendWorkspaceSourceFile(state, next);
};

const visitWorkspaceDirectory = (state: WorkspaceScanState, relative: string): void => {
  const entries = fs
    .readdirSync(path.join(state.root, relative), { withFileTypes: true })
    .sort((a, b) => compareText(a.name, b.name));
  for (const entry of entries) visitWorkspaceEntry(state, relative, entry);
};

export const readSnapshot = (input: string): Snapshot => {
  const requested = path.resolve(input);
  const selectedFile = path.join(
    fs.realpathSync(path.dirname(requested)),
    path.basename(requested),
  );
  const resolved = resolveWorkspaceConfigFile(selectedFile);
  if (resolved.kind === 'standalone') return resolved.snapshot;
  const { root, configuration, config } = loadWorkspaceConfig(resolved.file);
  if (input.endsWith('.ashfox')) assertEntryIncluded(config, root, selectedFile);
  const excluded = [
    '.git',
    'node_modules',
    '.ashfox',
    config.build.directory,
    ...config.exports.map((e) => e.directory),
    ...(config.packs ?? []).map((p) => p.directory),
  ];
  excluded.forEach((directory) => {
    if (directory !== '.git') noLinks(contained(root, directory));
  });
  const state: WorkspaceScanState = { root, config, excluded, files: [], visited: 0, total: 0 };
  visitWorkspaceDirectory(state, '');
  return {
    input: selectedFile,
    root,
    configuration,
    config,
    files: state.files,
    hash: digest(json({ configuration, files: state.files })),
  };
};
export const assertSnapshot = (snapshot: Snapshot): void => {
  if (readSnapshot(snapshot.input).hash !== snapshot.hash) {
    throw new BuildFailure('source.changed', 'Source changed during compilation');
  }
};

/** Observation deliberately ignores ancestor build configuration. */
export const readSingleSnapshot = (input: string): Snapshot =>
  readStandalone(path.resolve(input), readText);
