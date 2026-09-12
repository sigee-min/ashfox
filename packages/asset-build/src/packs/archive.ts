import { zipSync, type Zippable } from 'fflate';
import { BuildFailure, type Artifact } from '../bundle/contract';
import { safeRelative } from '../shared/path';
/** Stable folder and optional ZIP; no host paths or timestamps in archive bytes. */
export const archivePack = (
  name: string,
  root: string,
  archive: boolean,
  files: readonly Artifact[],
): readonly Artifact[] => {
  const ordered = [...files].sort((a, b) => (a.path < b.path ? -1 : 1)),
    paths = new Set<string>();
  for (const file of ordered) {
    const key = file.path.toLowerCase();
    if (!safeRelative(file.path) || paths.has(key))
      throw new BuildFailure('pack.collision', `${name}: ${file.path}`);
    paths.add(key);
  }
  for (const file of ordered) {
    const parts = file.path.toLowerCase().split('/');
    parts.pop();
    while (parts.length) {
      if (paths.has(parts.join('/')))
        throw new BuildFailure('pack.collision', `${name}: file/directory conflict ${file.path}`);
      parts.pop();
    }
  }
  if (
    ordered.length > 8192 ||
    ordered.reduce((size, f) => size + f.bytes.length, 0) > 64 * 1024 * 1024
  )
    throw new BuildFailure('pack.budget', name);
  const result = ordered.map((f) => ({ path: `${root}/${f.path}`, bytes: f.bytes }));
  if (archive) {
    const entries: Zippable = Object.fromEntries(
      ordered.map((f) => [
        f.path,
        [f.bytes, { level: 0, mtime: new Date(1980, 0, 1), os: 0, attrs: 0 }],
      ]),
    );
    result.push({ path: `${name}.zip`, bytes: zipSync(entries) });
  }
  return result;
};
