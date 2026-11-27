import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  isStdLibraryLogicalPath,
  mergeVirtualLibraryFiles,
  virtualLibraryLogicalPath,
  virtualLibrarySpecifierFromPath,
  type DirectoryFile,
} from '@ashfox/engine-core';
import { compareText } from '@ashfox/internal-contracts';
import { BuildFailure } from '../bundle/contract';
import { contained, noLinks, safeRelative } from './paths';

declare global {
  // Optional compile-time or test-time embedded standard library map keyed by "std/..." or "library/std/...".
  // eslint-disable-next-line no-var
  var ASHFOX_STD_LIBRARY: Readonly<Record<string, string>> | undefined;
}

const MAX_STD_FILES = 1024;
const MAX_STD_BYTES = 8 * 1024 * 1024;

let cachedDiskStdLibrary: ReadonlyMap<string, string> | null = null;

const normalizeStdEntries = (
  entries: Iterable<readonly [string, string]>,
): ReadonlyMap<string, string> => {
  const sorted: Array<readonly [string, string]> = [];
  for (const [key, source] of entries) {
    if (typeof source !== 'string') continue;
    const spec = isStdLibraryLogicalPath(key)
      ? virtualLibrarySpecifierFromPath(key)
      : virtualLibrarySpecifierFromPath(`library/${key}.ashfox`);
    if (spec) sorted.push([spec, source]);
  }
  sorted.sort((a, b) => compareText(a[0], b[0]));
  return new Map(sorted);
};

const readGlobalStdLibrary = (): ReadonlyMap<string, string> | null => {
  const embedded =
    typeof ASHFOX_STD_LIBRARY !== 'undefined' ? ASHFOX_STD_LIBRARY : globalThis.ASHFOX_STD_LIBRARY;
  if (!embedded || typeof embedded !== 'object') return null;
  return normalizeStdEntries(Object.entries(embedded));
};

const hasRepoLibraryDir = (dir: string): boolean => {
  const stdDir = path.join(dir, 'library', 'std');
  try {
    return (
      fs.statSync(stdDir).isDirectory() && fs.statSync(path.join(dir, 'package.json')).isFile()
    );
  } catch {
    return false;
  }
};

const findRepoRootFrom = (startDir: string): string | null => {
  let cursor = path.resolve(startDir);
  while (true) {
    if (hasRepoLibraryDir(cursor)) return cursor;
    const parent = path.dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
};

const findRepoLibraryRoot = (): string | null => {
  const moduleDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
  const root = findRepoRootFrom(moduleDir) ?? findRepoRootFrom(process.cwd());
  return root ? path.join(root, 'library', 'std') : null;
};

interface StdWalkState {
  readonly baseDir: string;
  readonly entries: Array<readonly [string, string]>;
  bytes: number;
}

const recordStdFile = (state: StdWalkState, relative: string): void => {
  if (!relative.endsWith('.ashfox')) return;
  const logicalPath = `library/std/${relative}`;
  const spec = virtualLibrarySpecifierFromPath(logicalPath);
  if (!spec) return;
  const source = fs.readFileSync(contained(state.baseDir, relative), 'utf8');
  state.bytes += Buffer.byteLength(source);
  if (state.entries.length >= MAX_STD_FILES || state.bytes > MAX_STD_BYTES) {
    throw new BuildFailure('source.budget', logicalPath);
  }
  state.entries.push([spec, source]);
};

const walkStdDir = (state: StdWalkState, relative: string): void => {
  const dir = relative ? path.join(state.baseDir, relative) : state.baseDir;
  const items = fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => compareText(a.name, b.name));
  for (const item of items) {
    const next = relative ? `${relative}/${item.name}` : item.name;
    if (!safeRelative(next)) throw new BuildFailure('source.path', next);
    if (item.isSymbolicLink()) throw new BuildFailure('source.symlink', `library/std/${next}`);
    if (item.isDirectory()) walkStdDir(state, next);
    else if (item.isFile()) recordStdFile(state, next);
  }
};

const readStdDirectoryMap = (stdDir: string): ReadonlyMap<string, string> => {
  if (!fs.existsSync(stdDir)) return new Map();
  noLinks(stdDir);
  if (!fs.statSync(stdDir).isDirectory()) return new Map();
  const state: StdWalkState = { baseDir: stdDir, entries: [], bytes: 0 };
  walkStdDir(state, '');
  state.entries.sort((a, b) => compareText(a[0], b[0]));
  return new Map(state.entries);
};

/** Clears the cached disk standard library snapshot (primarily for test isolation). */
export const clearStdLibraryCache = (): void => {
  cachedDiskStdLibrary = null;
};

/** Loads the bundled standard library from `ASHFOX_STD_LIBRARY` or walks `<repoRoot>/library/std`. */
export const loadBundledStdLibrary = (): ReadonlyMap<string, string> => {
  const fromGlobal = readGlobalStdLibrary();
  if (fromGlobal) return fromGlobal;
  if (cachedDiskStdLibrary) return cachedDiskStdLibrary;
  const libraryRoot = findRepoLibraryRoot();
  cachedDiskStdLibrary = libraryRoot ? readStdDirectoryMap(libraryRoot) : new Map();
  return cachedDiskStdLibrary;
};

/** Reads workspace-local `library/std/**` overrides beneath `workspaceRoot`, if present. */
export const collectLocalStdOverrides = (workspaceRoot: string): ReadonlyMap<string, string> =>
  readStdDirectoryMap(path.join(workspaceRoot, 'library', 'std'));

/** Merges base virtual stdlib entries with workspace-local `library/std/**` overrides. */
export const resolveEffectiveStdLibraries = (
  virtualLibraries?: ReadonlyMap<string, string>,
  workspaceRoots: readonly string[] = [],
): ReadonlyMap<string, string> => {
  const merged = new Map(virtualLibraries ?? loadBundledStdLibrary());
  for (const root of workspaceRoots) {
    for (const [spec, source] of collectLocalStdOverrides(root)) {
      merged.set(spec, source);
    }
  }
  const sorted = [...merged.entries()].sort((a, b) => compareText(a[0], b[0]));
  return new Map(sorted);
};

/** Injects transitively referenced virtual `std/*` files deterministically; local overrides win. */
export const resolveStdLibraryFiles = (
  files: readonly DirectoryFile[],
  virtualLibraries?: ReadonlyMap<string, string>,
  workspaceRoot?: string,
): readonly DirectoryFile[] => {
  const roots = workspaceRoot ? [workspaceRoot] : [];
  const effective = resolveEffectiveStdLibraries(virtualLibraries, roots);
  const withLocalDisk = applyLocalOverridesToExisting(files, effective, workspaceRoot);
  const merged = mergeVirtualLibraryFiles(withLocalDisk, effective, (filePath, source) => ({
    path: filePath,
    source,
  }));
  if (merged.length === withLocalDisk.length) return withLocalDisk;
  const baseCount = withLocalDisk.length;
  const added = merged.slice(baseCount).sort((a, b) => compareText(a.path, b.path));
  return [...withLocalDisk, ...added];
};

const applyLocalOverridesToExisting = (
  files: readonly DirectoryFile[],
  effective: ReadonlyMap<string, string>,
  workspaceRoot?: string,
): readonly DirectoryFile[] => {
  if (!workspaceRoot) return files;
  const overrides = collectLocalStdOverrides(workspaceRoot);
  if (overrides.size === 0) return files;
  const overrideByPath = new Map(
    [...overrides.entries()].map(([spec, source]) => [virtualLibraryLogicalPath(spec), source]),
  );
  let changed = false;
  const updated = files.map((file) => {
    const localSource = overrideByPath.get(file.path) ?? effective.get(file.path);
    if (localSource === undefined || localSource === file.source) return file;
    changed = true;
    return { path: file.path, source: localSource };
  });
  return changed ? updated : files;
};
