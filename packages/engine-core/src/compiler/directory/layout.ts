import { parseSoundUnit } from '@ashfox/audio-core';
import { deepFreeze } from '../../immutable';
import type { DirectoryFile, DirectoryWorkspace } from '../../project/directory/contract';
import { type NativeSourceMetadata } from '../../project/directory/source';
import type { DeclaredAssetKind } from '../../project/directory/declarations';
import { parseAssetSource } from '../../project/program/asset/parse';
import { lexProgramSource } from '../../project/program/syntax/lex';
import { parseSpriteSource } from '../../project/sprite/source';
import { parseStructureSource } from '../../project/structure';
import { parseVfxSource } from '../../project/vfx/source';
import { assertWellFormedSourceText } from '../../project/workspace/path';
import type { DirectoryWorkspaceCache } from './cache';

const CANONICAL_PREFIXES = [
  'assets/models/',
  'assets/sprites/',
  'assets/sounds/',
  'assets/structures/',
  'assets/vfx/',
  'assets/module/',
] as const;

const BUCKET_BY_KIND: Readonly<Record<DeclaredAssetKind, string>> = {
  model: 'assets/models/',
  sprite: 'assets/sprites/',
  sound: 'assets/sounds/',
  structure: 'assets/structures/',
  vfx: 'assets/vfx/',
};

const isUnder = (filePath: string, prefix: string): boolean => filePath.startsWith(prefix);

const resolveRelativeImport = (ownerPath: string, specifier: string): string | null => {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return null;
  const parts = ownerPath.split('/').slice(0, -1);
  for (const segment of specifier.split('/')) {
    if (segment === '.') continue;
    if (segment === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else if (segment) {
      parts.push(segment);
    }
  }
  return parts.join('/');
};

type InspectedMap = ReadonlyMap<string, NativeSourceMetadata>;

const toModuleMeta = (
  id: string,
  imports: readonly { readonly path: string }[],
): NativeSourceMetadata =>
  Object.freeze({
    kind: 'module',
    id,
    imports: Object.freeze(imports.map((i) => i.path)),
    outputs: Object.freeze([]),
  });

const tryParseModule = <
  T extends {
    readonly kind: string;
    readonly id: string;
    readonly imports: readonly { readonly path: string }[];
  },
>(
  parse: () => T,
  onModule?: (unit: T) => void,
): NativeSourceMetadata | null => {
  try {
    const unit = parse();
    if (unit.kind !== 'module') return null;
    onModule?.(unit);
    return toModuleMeta(unit.id, unit.imports);
  } catch {
    return null;
  }
};

const parseModuleMetadata = (
  source: string,
  filePath: string,
  cache?: DirectoryWorkspaceCache,
): NativeSourceMetadata | null =>
  tryParseModule(
    () => parseSpriteSource(source, filePath),
    (sp) => cache?.spriteUnits.set(filePath, sp),
  ) ??
  tryParseModule(
    () => parseStructureSource(source, filePath),
    (st) => cache?.structureUnits.set(filePath, deepFreeze(st)),
  ) ??
  tryParseModule(() => parseSoundUnit(source, filePath)) ??
  tryParseModule(() => parseVfxSource(source, filePath));

const inspectUnitMetadata = (
  source: string,
  filePath: string,
  kind: string | undefined,
  cache?: DirectoryWorkspaceCache,
): NativeSourceMetadata => {
  if (kind === 'sound') {
    const sound = parseSoundUnit(source, filePath);
    if (sound.kind !== 'sound') throw new Error(`${filePath}: expected sound declaration`);
    return Object.freeze({
      kind: 'sound',
      id: sound.id,
      imports: Object.freeze(sound.imports.map((i) => i.path)),
      outputs: Object.freeze([...sound.outputs]),
    });
  }
  if (kind === 'sprite') {
    const sprite = parseSpriteSource(source, filePath);
    cache?.spriteUnits.set(filePath, sprite);
    return Object.freeze({
      kind: 'sprite',
      id: sprite.id,
      imports: Object.freeze(sprite.imports.map((i) => i.path)),
      outputs: Object.freeze([...sprite.outputs]),
    });
  }
  if (kind === 'structure' || kind === 'compound') {
    const structure = parseStructureSource(source, filePath);
    cache?.structureUnits.set(filePath, deepFreeze(structure));
    return Object.freeze({
      kind: 'structure',
      id: structure.id,
      imports: Object.freeze(structure.imports.map((i) => i.path)),
      outputs: Object.freeze([...structure.outputs]),
    });
  }
  if (kind === 'vfx') {
    const vfx = parseVfxSource(source, filePath);
    return Object.freeze({
      kind: 'vfx',
      id: vfx.id,
      imports: Object.freeze(vfx.imports.map((i) => i.path)),
      outputs: Object.freeze([...vfx.outputs]),
    });
  }
  const model = parseAssetSource(source, filePath);
  cache?.assetUnits.set(filePath, model);
  if (model.unit && !model.diagnostics.length) {
    return Object.freeze({
      kind: model.unit.kind === 'asset' ? 'model' : 'module',
      id: model.unit.id,
      imports: Object.freeze(model.unit.imports.map((i) => i.path)),
      outputs: Object.freeze(model.unit.kind === 'asset' ? [...model.unit.outputs] : []),
    });
  }
  const mod = kind === 'module' ? parseModuleMetadata(source, filePath, cache) : null;
  if (mod) return mod;
  throw new Error(JSON.stringify(model.diagnostics));
};

const inspectCachedSource = (
  source: string,
  filePath: string,
  cache?: DirectoryWorkspaceCache,
): NativeSourceMetadata => {
  const cached = cache?.inspected.get(filePath);
  if (cached) return cached;
  assertWellFormedSourceText(source);
  const kind = lexProgramSource(source).tokens[2]?.value;
  cache?.topKinds.set(filePath, kind);
  const meta = inspectUnitMetadata(source, filePath, kind, cache);
  cache?.inspected.set(filePath, meta);
  return meta;
};

const recordImportDep = (
  entryPath: string,
  target: string | null,
  seen: Set<string>,
  queue: string[],
  inspected: InspectedMap,
  importersByModule: Map<string, Set<string>>,
): void => {
  if (!target || seen.has(target)) return;
  seen.add(target);
  const targetMeta = inspected.get(target);
  if (!targetMeta) return;
  if (targetMeta.kind === 'module') {
    const owners = importersByModule.get(target) ?? new Set<string>();
    owners.add(entryPath);
    importersByModule.set(target, owners);
  }
  queue.push(target);
};

const collectEntryModuleDeps = (
  entryPath: string,
  inspected: InspectedMap,
  importersByModule: Map<string, Set<string>>,
): void => {
  const queue = [entryPath];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const cur = queue.pop()!;
    const meta = inspected.get(cur);
    if (!meta) continue;
    for (const spec of meta.imports) {
      recordImportDep(
        entryPath,
        resolveRelativeImport(cur, spec),
        seen,
        queue,
        inspected,
        importersByModule,
      );
    }
  }
};

const inspectWorkspaceFiles = (
  filesByPath: ReadonlyMap<string, DirectoryFile>,
  cache?: DirectoryWorkspaceCache,
): InspectedMap => {
  const inspected = new Map<string, NativeSourceMetadata>();
  for (const [filePath, file] of filesByPath) {
    if (!CANONICAL_PREFIXES.some((prefix) => isUnder(filePath, prefix))) {
      throw new Error(
        `${filePath}: layout.root: Source files must live under assets/{models,sprites,sounds,structures,module}/`,
      );
    }
    const meta = inspectCachedSource(file.source, filePath, cache);
    inspected.set(filePath, meta);
    if (isUnder(filePath, 'assets/module/') && meta.kind !== 'module') {
      throw new Error(
        `${filePath}: layout.module-only: Only module units are allowed under assets/module/`,
      );
    }
  }
  return inspected;
};

/** Enforces canonical boilerplate directory layout at compile time for multi-asset workspaces. */
export const validateCanonicalLayout = (
  config: DirectoryWorkspace,
  filesByPath: ReadonlyMap<string, DirectoryFile>,
  entryPaths: readonly string[],
  cache?: DirectoryWorkspaceCache,
): void => {
  if (config.name === 'standalone') return;
  const inspected = inspectWorkspaceFiles(filesByPath, cache);
  const importersByModule = new Map<string, Set<string>>();
  for (const entryPath of new Set(entryPaths)) {
    const meta = inspected.get(entryPath);
    if (!meta || meta.kind === 'module') continue;
    const expectedBucket = BUCKET_BY_KIND[meta.kind];
    if (!isUnder(entryPath, expectedBucket)) {
      throw new Error(
        `${entryPath}: layout.kind-mismatch: ${meta.kind} entry must live under ${expectedBucket}`,
      );
    }
    collectEntryModuleDeps(entryPath, inspected, importersByModule);
  }
  for (const [modPath, owners] of importersByModule) {
    if (owners.size >= 2 && !isUnder(modPath, 'assets/module/')) {
      throw new Error(
        `${modPath}: layout.shared-in-module: Shared module imported by ${owners.size} entries must live under assets/module/`,
      );
    }
  }
};
