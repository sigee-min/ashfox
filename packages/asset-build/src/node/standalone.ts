import { compareText } from '@ashfox/internal-contracts';
import * as path from 'node:path';
import {
  inspectNativeSource,
  readDirectoryWorkspace,
  validateAssetDeclarations,
  type DeclaredOutputSpec,
  type DirectoryExport,
  type DirectoryFile,
} from '@ashfox/engine-core';
import { BuildFailure, type Snapshot } from '../bundle/contract';
import { digest, json } from '../shared/digest';
import { contained, safeRelative } from './paths';

const CANONICAL_BUCKETS = new Set(['models', 'sprites', 'sounds', 'structures']);

const resolveStandaloneAnchor = (
  input: string,
): { readonly root: string; readonly entryPath: string } => {
  let cursor = path.dirname(input);
  const segments = [path.basename(input)];
  while (segments.length <= 4) {
    const base = path.basename(cursor);
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    segments.unshift(base);
    if (CANONICAL_BUCKETS.has(base) && path.basename(parent) === 'assets') {
      return { root: parent, entryPath: segments.join('/') };
    }
    cursor = parent;
  }
  return { root: path.dirname(input), entryPath: path.basename(input) };
};

interface StandaloneVisitState {
  readonly root: string;
  readonly readText: (file: string, limit: number) => string;
  readonly files: DirectoryFile[];
  readonly active: Set<string>;
  readonly seen: Set<string>;
  total: number;
}

const assertChildKind = (childKind: string, rootKind: string, target: string): void => {
  const valid =
    childKind === 'module' ||
    ((rootKind === 'structure' || rootKind === 'compound') &&
      (childKind === 'model' || childKind === 'structure'));
  if (!valid) throw new BuildFailure('source.import', 'Expected module: ' + target);
};

const visitStandaloneModule = (
  state: StandaloneVisitState,
  relative: string,
  depth: number,
  rootKind?: string,
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
  const effectiveRootKind = rootKind ?? unit.kind;
  for (const specifier of unit.imports) {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
      throw new BuildFailure(
        'source.import',
        'Package imports require optional .ashfoxworkspace configuration: ' + specifier,
      );
    }
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(relative), specifier));
    const child = visitStandaloneModule(state, target, depth + 1, effectiveRootKind);
    assertChildKind(child.kind, effectiveRootKind, target);
  }
  state.active.delete(relative);
  return unit;
};

const sanitizeExportId = (id: string): string => {
  const clean = id.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const prefixed = /^[a-z]/.test(clean) ? clean : 'a_' + clean;
  return prefixed.slice(0, 48);
};

const toStandaloneExport = (
  entryId: string,
  spec: DeclaredOutputSpec,
  index: number,
  multi: boolean,
  usedNames: Set<string>,
): DirectoryExport => {
  const baseName = multi
    ? sanitizeExportId(`${entryId}_${spec.format}`)
    : sanitizeExportId(entryId);
  let name = baseName;
  if (usedNames.has(name)) name = sanitizeExportId(`${baseName}_${index}`);
  usedNames.add(name);
  const directory = multi
    ? `dist/${entryId}/exports/${index === 0 ? spec.format : `${spec.format}_${index}`}`
    : `dist/${entryId}/exports`;
  const selector = { packageName: 'standalone', entryName: entryId };
  if (spec.format === 'java_block' || spec.format === 'geckolib5' || spec.format === 'bedrock') {
    return {
      name,
      entry: selector,
      directory,
      format: spec.format,
      namespace: spec.namespace ?? 'ashfox',
      modelPath: spec.modelPath ?? entryId,
    };
  }
  if (spec.format === 'glb' || spec.format === 'gltf') {
    return {
      name,
      entry: selector,
      directory,
      format: spec.format,
      ...(spec.encoding ? { encoding: spec.encoding } : {}),
      ...(spec.modelPath ? { modelPath: spec.modelPath } : {}),
    };
  }
  return { name, entry: selector, directory, format: spec.format };
};

const buildStandaloneConfig = (
  entry: ReturnType<typeof inspectNativeSource>,
  entryPath: string,
  files: readonly DirectoryFile[],
): string => {
  if (entry.kind === 'module')
    throw new BuildFailure('source.entry', 'A module is not a build entry', 2);
  const { outputs } = validateAssetDeclarations(entry.kind, entry.outputs, [], entryPath);
  const multi = outputs.length > 1;
  const usedNames = new Set<string>();
  const exports = outputs.map((spec, idx) =>
    toStandaloneExport(entry.id, spec, idx, multi, usedNames),
  );
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
    exports,
  });
};

/** A transient compilation context, never a generated project configuration file. */
export const readStandalone = (
  input: string,
  readText: (file: string, limit: number) => string,
): Snapshot => {
  const { root, entryPath } = resolveStandaloneAnchor(input);
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
  state.files.sort((a, b) => compareText(a.path, b.path));
  return {
    input,
    root,
    configuration,
    config: readDirectoryWorkspace(configuration),
    files: state.files,
    hash: digest(json({ configuration, files: state.files })),
  };
};
