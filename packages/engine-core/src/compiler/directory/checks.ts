import { compareText, encodeUtf8 } from '@ashfox/internal-contracts';
import type { DirectoryFile, DirectoryWorkspace } from '../../project/directory/contract';
import { directoryPath, isDirectorySource } from '../../project/directory/read';
import type { WorkspaceEntrySelector } from '../../project/workspace';

export type DirectoryEntry = { readonly entry: WorkspaceEntrySelector; readonly path: string };

export const joinPath = (root: string, path: string): string =>
  [root, path].filter(Boolean).join('/');

export const entryKey = (entry: {
  readonly packageName: string;
  readonly entryName: string;
}): string => JSON.stringify([entry.packageName, entry.entryName]);

export const sortDirectoryProducts = <
  T extends { readonly entry: { readonly packageName: string; readonly entryName: string } },
>(
  products: T[],
): T[] => products.sort((a, b) => compareText(entryKey(a.entry), entryKey(b.entry)));

export const assertSourceBudget = (files: readonly DirectoryFile[]): void => {
  const bytes = files.reduce((n, f) => n + encodeUtf8(f.source).length, 0);
  if (files.length > 512 || bytes > 8 * 1024 * 1024)
    throw new Error('Workspace source budget exceeded');
};

/** Index of the supplied files after proving they match the declared closed source set. */
export const declaredFiles = (
  config: DirectoryWorkspace,
  files: readonly DirectoryFile[],
): ReadonlyMap<string, DirectoryFile> => {
  const declared = new Set(
    config.packages.flatMap((p) =>
      [...p.manifest.entries, ...p.manifest.modules].map((e) => joinPath(p.root, e.path)),
    ),
  );
  const seen = new Set<string>();
  for (const f of files) {
    const accepted =
      directoryPath(f.path) &&
      isDirectorySource(config, f.path) &&
      declared.has(f.path) &&
      !seen.has(f.path.toLowerCase());
    if (!accepted) throw new Error('Undeclared, ignored or duplicate source: ' + f.path);
    seen.add(f.path.toLowerCase());
  }
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  for (const p of declared) if (!filesByPath.has(p)) throw new Error('Missing source: ' + p);
  return filesByPath;
};

export const declaredEntries = (config: DirectoryWorkspace): readonly DirectoryEntry[] => {
  const entries = config.packages.flatMap((p) =>
    p.manifest.entries.map((e) => ({
      entry: { packageName: p.name, entryName: e.name },
      path: joinPath(p.root, e.path),
    })),
  );
  if (!entries.length) throw new Error('Workspace must declare an entry');
  return entries;
};
