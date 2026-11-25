import * as path from 'node:path';
import {
  inspectNativeSource,
  readDirectoryWorkspace,
  type DirectoryFile,
} from '@ashfox/engine-core';
import { BuildFailure, type Snapshot } from '../bundle/contract';
import { digest, json } from '../shared/digest';
import { contained, safeRelative } from './paths';

interface StandaloneVisitState {
  readonly root: string;
  readonly readText: (file: string, limit: number) => string;
  readonly files: DirectoryFile[];
  readonly active: Set<string>;
  readonly seen: Set<string>;
  total: number;
}

const visitStandaloneModule = (
  state: StandaloneVisitState,
  relative: string,
  depth: number,
): ReturnType<typeof inspectNativeSource> => {
  if (depth > 32 || state.active.has(relative)) throw new BuildFailure('source.cycle', relative);
  if (!safeRelative(relative) || !relative.endsWith('.ashfox'))
    throw new BuildFailure('source.path', relative);
  const source = state.readText(contained(state.root, relative), 262144);
  const unit = inspectNativeSource(source, relative);
  if (state.seen.has(relative)) return unit;
  state.total += Buffer.byteLength(source);
  if (state.total > 8 * 1024 * 1024 || state.files.length >= 512)
    throw new BuildFailure('source.budget', relative);
  state.files.push({ path: relative, source });
  state.seen.add(relative);
  state.active.add(relative);
  for (const specifier of unit.imports) {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
      throw new BuildFailure(
        'source.import',
        'Package imports require optional .ashfoxworkspace configuration: ' + specifier,
      );
    }
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(relative), specifier));
    if (visitStandaloneModule(state, target, depth + 1).kind !== 'module')
      throw new BuildFailure('source.import', 'Expected module: ' + target);
  }
  state.active.delete(relative);
  return unit;
};

const buildStandaloneConfig = (
  entry: ReturnType<typeof inspectNativeSource>,
  entryPath: string,
  files: readonly DirectoryFile[],
): string => {
  if (entry.kind === 'module')
    throw new BuildFailure('source.entry', 'A module is not a build entry', 2);
  return json({
    format: 'ashfox-workspace',
    version: 2,
    name: 'standalone',
    packages: [
      {
        name: 'standalone',
        root: '',
        manifest: {
          format: 'ashfox-package',
          version: 1,
          entries: [{ name: entry.id, path: entryPath }],
          modules: files
            .filter((f) => f.path !== entryPath)
            .map((f, i) => ({ subpath: './module' + i, path: f.path })),
          dependencies: [],
        },
      },
    ],
    include: ['**/*.ashfox'],
    ignore: [],
    build: { directory: 'dist/' + entry.id + '/build' },
    exports: [
      {
        name: entry.id,
        entry: { packageName: 'standalone', entryName: entry.id },
        format: { model: 'glb', sprite: 'png', sound: 'wav' }[entry.kind],
        directory: 'dist/' + entry.id + '/exports',
      },
    ],
  });
};

/** A transient compilation context, never a generated project configuration file. */
export const readStandalone = (
  input: string,
  readText: (file: string, limit: number) => string,
): Snapshot => {
  const root = path.dirname(input),
    entryPath = path.basename(input);
  const state: StandaloneVisitState = {
    root,
    readText,
    files: [],
    active: new Set<string>(),
    seen: new Set<string>(),
    total: 0,
  };
  const entry = visitStandaloneModule(state, entryPath, 0);
  const configuration = buildStandaloneConfig(entry, entryPath, state.files);
  state.files.sort((a, b) => (a.path < b.path ? -1 : 1));
  return {
    input,
    root,
    configuration,
    config: readDirectoryWorkspace(configuration),
    files: state.files,
    hash: digest(json({ configuration, files: state.files })),
  };
};
