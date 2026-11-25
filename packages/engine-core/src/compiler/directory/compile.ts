import { AUDIO_POLICY, type SoundProduct } from '@ashfox/audio-core';
import {
  validateAssetDeclarations,
  type AssetDeclarations,
} from '../../project/directory/declarations';
import { parseAssetSource } from '../../project/program/asset/parse';
import {
  readDirectoryWorkspace,
  isDirectorySource,
  directoryPath,
} from '../../project/directory/read';
import type { DirectoryFile, DirectoryWorkspace } from '../../project/directory/contract';
import { lexProgramSource } from '../../project/program/syntax/lex';
import { compilePreparedSound, prepareDirectorySound } from './sound';
import { validateCanonicalLayout } from './layout';
import { compileDirectorySprite } from './sprite';
import { collectStructureOnlyCustomPaths, compileDirectoryStructure } from './structure';
import type { SpriteProduct } from '../sprite/contract';
import type { StructureProduct } from '../structure/contract';
import { StructureInputError } from '../../project/structure';
import { sha256Digest } from '../../provenance/digest';
import { SPRITE_POLICY, SpriteInputError } from '../../project/sprite/contract';
import { sealWorkspaceCandidate } from '../../project/workspace/seal';
import {
  DEFAULT_WORKSPACE_LIMITS,
  ASHFOX_WORKSPACE_COMPILER_FINGERPRINT,
  type AuthoredAssetWorkspace,
  type WorkspaceEntrySelector,
} from '../../project/workspace';
import { compileWorkspaceCandidate } from '../program/asset/workspaceCompile';
import type { AssetAuthoringTelemetry } from '../program/asset/texture/telemetry';
import type { SpriteSourceUnit } from '../../project/sprite/source';
import type { CompiledModel } from '../../model/compiled';

export type DirectoryProduct =
  | {
      readonly kind: 'sprite';
      readonly entry: WorkspaceEntrySelector;
      readonly sourcePath: string;
      readonly sprite: SpriteProduct;
      readonly declarations: AssetDeclarations;
    }
  | {
      readonly kind: 'model';
      readonly entry: WorkspaceEntrySelector;
      readonly sourcePath: string;
      readonly model: CompiledModel;
      readonly workspace: AuthoredAssetWorkspace;
      readonly telemetry?: AssetAuthoringTelemetry;
      readonly declarations: AssetDeclarations;
    }
  | {
      readonly kind: 'sound';
      readonly entry: WorkspaceEntrySelector;
      readonly sourcePath: string;
      readonly sounds: readonly SoundProduct[];
      readonly declarations: AssetDeclarations;
    }
  | {
      readonly kind: 'structure';
      readonly entry: WorkspaceEntrySelector;
      readonly sourcePath: string;
      readonly structure: StructureProduct;
      readonly declarations: AssetDeclarations;
    };
type DirectoryDiagnostic = {
  readonly code: string;
  readonly file: string;
  readonly message: string;
};
export type DirectoryCompilation =
  | {
      readonly ok: true;
      readonly config: DirectoryWorkspace;
      readonly sourceHash: string;
      readonly buildKey: string;
      readonly products: readonly DirectoryProduct[];
    }
  | { readonly ok: false; readonly diagnostics: readonly DirectoryDiagnostic[] };
type DirectoryFailure = Extract<DirectoryCompilation, { readonly ok: false }>;
type Entry = { readonly entry: WorkspaceEntrySelector; readonly path: string };
type PreparedSound = ReturnType<typeof prepareDirectorySound>;
type Files = ReadonlyMap<string, DirectoryFile>;

/** Mutable product accumulator shared by the entry compilers. */
interface EntryOutput {
  readonly products: DirectoryProduct[];
  readonly spritePaths: Set<string>;
  readonly structureCustomPaths: Set<string>;
  readonly modelEntries: Entry[];
}

const EXPORT_FORMATS = {
  sprite: ['png'],
  model: ['glb', 'gltf', 'java_block', 'geckolib5', 'bedrock'],
  sound: ['wav'],
  structure: ['java_structure', 'glb'],
} as const;
const SOUND_LIMITS = {
  sources: 32,
  outputFrames: 11520000,
  eventFrames: 24000000,
  weightedFrames: 192000000,
} as const;

const entryKey = (entry: WorkspaceEntrySelector): string =>
  JSON.stringify([entry.packageName, entry.entryName]);
const ordered = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(ordered)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, x]) => [k, ordered(x)]),
        )
      : v;
const joinPath = (root: string, path: string): string => [root, path].filter(Boolean).join('/');

const assertSourceBudget = (files: readonly DirectoryFile[]): void => {
  const bytes = files.reduce((n, f) => n + new TextEncoder().encode(f.source).length, 0);
  if (files.length > 512 || bytes > 8 * 1024 * 1024)
    throw new Error('Workspace source budget exceeded');
};

/** Index of the supplied files after proving they match the declared closed source set. */
const declaredFiles = (config: DirectoryWorkspace, files: readonly DirectoryFile[]): Files => {
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

const declaredEntries = (config: DirectoryWorkspace): readonly Entry[] => {
  const entries = config.packages.flatMap((p) =>
    p.manifest.entries.map((e) => ({
      entry: { packageName: p.name, entryName: e.name },
      path: joinPath(p.root, e.path),
    })),
  );
  if (!entries.length) throw new Error('Workspace must declare an entry');
  return entries;
};

/** Prepares every sound entry and module while enforcing cumulative workspace sound budgets. */
const prepareSoundEntries = (
  entries: readonly Entry[],
  kinds: ReadonlyMap<string, string | undefined>,
  filesByPath: Files,
): ReadonlyMap<string, PreparedSound> => {
  const prepared = new Map<string, PreparedSound>();
  const total = { outputFrames: 0, eventFrames: 0, weightedFrames: 0 };
  for (const e of entries) {
    if (kinds.get(e.path) !== 'sound') continue;
    const item = prepareDirectorySound(filesByPath, e.path);
    prepared.set(e.path, item);
    total.outputFrames += item.budget.outputFrames;
    total.eventFrames += item.budget.eventFrames;
    total.weightedFrames += item.budget.weightedFrames;
    assertSoundBudget(e.path, prepared.size, total);
  }
  return prepared;
};

const assertSoundBudget = (
  path: string,
  sources: number,
  total: {
    readonly outputFrames: number;
    readonly eventFrames: number;
    readonly weightedFrames: number;
  },
): void => {
  const exceeded =
    sources > SOUND_LIMITS.sources ||
    total.outputFrames > SOUND_LIMITS.outputFrames ||
    total.eventFrames > SOUND_LIMITS.eventFrames ||
    total.weightedFrames > SOUND_LIMITS.weightedFrames;
  if (exceeded)
    throw new Error(
      `${path}: sound workspace budget exceeded: sources=${sources}/32, rawFrames=${total.outputFrames}/11520000, eventFrames=${total.eventFrames}/24000000, weightedFrames=${total.weightedFrames}/192000000`,
    );
};

const compileSpriteEntry = (
  e: Entry,
  filesByPath: Files,
  spriteUnits: Map<string, SpriteSourceUnit>,
  output: EntryOutput,
): DirectoryFailure | null => {
  const compiled = compileDirectorySprite(filesByPath, e.path, spriteUnits);
  if (!compiled.result.ok)
    return {
      ok: false,
      diagnostics: compiled.result.diagnostics.map((d) => ({
        code: d.code,
        file: d.file,
        message: d.pointer + ': ' + d.expected + '; ' + d.actual,
      })),
    };
  const sprite = compiled.result.products[0]!;
  if (sprite.id !== e.entry.entryName)
    throw new Error('Entry name must match sprite id: ' + e.path);
  const unit = spriteUnits.get(e.path)!;
  const declarations = validateAssetDeclarations('sprite', unit.outputs, unit.previews, e.path);
  output.products.push({
    kind: 'sprite',
    entry: e.entry,
    sourcePath: e.path,
    sprite,
    declarations,
  });
  compiled.paths.forEach((p) => output.spritePaths.add(p));
  return null;
};

const compileSoundEntry = (e: Entry, prepared: PreparedSound, output: EntryOutput): void => {
  const compiled = compilePreparedSound(prepared, e.path);
  if (compiled.unit.id !== e.entry.entryName) {
    throw new Error('Entry name must match sound id: ' + e.path);
  }
  const declarations = validateAssetDeclarations(
    'sound',
    compiled.unit.outputs,
    compiled.unit.previews,
    e.path,
  );
  output.products.push({
    kind: 'sound',
    entry: e.entry,
    sourcePath: e.path,
    sounds: compiled.sounds,
    declarations,
  });
  compiled.soundPaths.forEach((p) => output.spritePaths.add(p));
};

const compileStructureEntry = (e: Entry, filesByPath: Files, output: EntryOutput): void => {
  const result = compileDirectoryStructure(filesByPath, e.path);
  if (result.structure.id !== e.entry.entryName)
    throw new Error('Entry name must match structure id: ' + e.path);
  const declarations = validateAssetDeclarations(
    'structure',
    result.rootUnit.outputs,
    result.rootUnit.previews,
    e.path,
  );
  output.products.push({
    kind: 'structure',
    entry: e.entry,
    sourcePath: e.path,
    structure: result.structure,
    declarations,
  });
  result.structurePaths.forEach((p) => output.spritePaths.add(p));
  result.customPaths.forEach((p) => output.structureCustomPaths.add(p));
};

/** Compiles sprite, structure, and sound entries in declaration order and defers models. */
const compileEntries = (
  entries: readonly Entry[],
  filesByPath: Files,
): EntryOutput | DirectoryFailure => {
  const kinds = new Map(
    entries.map((e) => [
      e.path,
      lexProgramSource(filesByPath.get(e.path)!.source).tokens[2]?.value,
    ]),
  );
  const spriteUnits = new Map<string, SpriteSourceUnit>();
  const preparedSounds = prepareSoundEntries(entries, kinds, filesByPath);
  const output: EntryOutput = {
    products: [],
    spritePaths: new Set(),
    structureCustomPaths: new Set(),
    modelEntries: [],
  };
  for (const e of entries) {
    const kind = kinds.get(e.path);
    if (kind === 'sprite') {
      const failure = compileSpriteEntry(e, filesByPath, spriteUnits, output);
      if (failure) return failure;
    } else if (kind === 'sound') compileSoundEntry(e, preparedSounds.get(e.path)!, output);
    else if (kind === 'structure') compileStructureEntry(e, filesByPath, output);
    else output.modelEntries.push(e);
  }
  return output;
};

const modelManifest = (
  config: DirectoryWorkspace,
  output: EntryOutput,
  excludedCustom: ReadonlySet<string>,
) => {
  const modelPaths = new Set(output.modelEntries.map((e) => e.path));
  const packages = config.packages.map((p) => ({
    ...p,
    manifest: {
      ...p.manifest,
      entries: p.manifest.entries.filter((e) => modelPaths.has(joinPath(p.root, e.path))),
      modules: p.manifest.modules.filter((e) => {
        const pth = joinPath(p.root, e.path);
        return !output.spritePaths.has(pth) && !excludedCustom.has(pth);
      }),
    },
  }));
  return { format: 'ashfox-workspace' as const, version: 1 as const, packages };
};

/** Seals the non-sprite sources as one model workspace and compiles every model entry. */
const compileModels = (
  config: DirectoryWorkspace,
  files: readonly DirectoryFile[],
  output: EntryOutput,
): void => {
  if (!output.modelEntries.length) {
    if (
      files.some((f) => !output.spritePaths.has(f.path) && !output.structureCustomPaths.has(f.path))
    )
      throw new Error('Every declared module must be reachable');
    return;
  }
  const filesByPath = new Map(files.map((f) => [f.path, f]));
  const excludedCustom = collectStructureOnlyCustomPaths(
    config,
    output.modelEntries.map((e) => e.path),
    output.structureCustomPaths,
    filesByPath,
  );
  const manifest = modelManifest(config, output, excludedCustom);
  const base: AuthoredAssetWorkspace = {
    files: [],
    manifest,
    lock: {
      format: 'ashfox-lock',
      version: 1,
      compilerFingerprint: ASHFOX_WORKSPACE_COMPILER_FINGERPRINT,
      packages: [],
    },
  };
  const sources = files.filter((f) => !output.spritePaths.has(f.path) && !excludedCustom.has(f.path));
  const sealed = sealWorkspaceCandidate(base, sources, manifest, DEFAULT_WORKSPACE_LIMITS);
  if (!sealed.ok) throw new Error(JSON.stringify(sealed.diagnostics));
  const checked = compileWorkspaceCandidate(sealed.value, {}, true);
  if (!checked.ok) throw new Error(JSON.stringify(checked.diagnostics));
  const modelSources = new Map(output.modelEntries.map((e) => [entryKey(e.entry), e.path]));
  for (const result of checked.products) {
    const sourcePath = modelSources.get(entryKey(result.entry))!;
    const parsedUnit = parseAssetSource(filesByPath.get(sourcePath)!.source, sourcePath).unit;
    const rawOutputs = parsedUnit?.kind === 'asset' ? parsedUnit.outputs : [];
    const rawPreviews = parsedUnit?.kind === 'asset' ? parsedUnit.previews : [];
    const declarations = validateAssetDeclarations('model', rawOutputs, rawPreviews, sourcePath);
    output.products.push({
      kind: 'model',
      entry: result.entry,
      sourcePath,
      model: result.model,
      workspace: checked.workspace,
      declarations,
      ...(result.telemetry !== undefined ? { telemetry: result.telemetry } : {}),
    });
  }
};

const assertExports = (
  config: DirectoryWorkspace,
  productsByEntry: ReadonlyMap<string, DirectoryProduct>,
): void => {
  for (const target of config.exports) {
    const p = productsByEntry.get(entryKey(target.entry))!;
    if (!EXPORT_FORMATS[p.kind].some((format) => format === target.format))
      throw new Error('Export format does not match entry kind: ' + target.name);
  }
};

const assertPackSounds = (
  config: DirectoryWorkspace,
  productsByEntry: ReadonlyMap<string, DirectoryProduct>,
): void => {
  const exportsByName = new Map(config.exports.map((target) => [target.name, target]));
  for (const pack of config.packs ?? [])
    for (const sound of pack.format === 'minecraft_java' ? pack.sounds : []) {
      const target = exportsByName.get(sound.source)!;
      const product = productsByEntry.get(entryKey(target.entry));
      if (product?.kind !== 'sound')
        throw new Error('Pack sound source kind mismatch: ' + sound.source);
      const unknownVariant =
        sound.variants !== 'all' &&
        sound.variants.some((v) => !product.sounds.some((s) => s.variant === v.id));
      if (unknownVariant)
        throw new Error('Unknown sound variant in pack: ' + pack.name + '/' + sound.id);
    }
};

const productOrder = (a: DirectoryProduct, b: DirectoryProduct): number => {
  const left = a.entry.packageName + ':' + a.entry.entryName,
    right = b.entry.packageName + ':' + b.entry.entryName;
  return left < right ? -1 : left > right ? 1 : 0;
};

const compileFailure = (error: unknown): DirectoryFailure => {
  const sprite = error instanceof SpriteInputError ? error.diagnostic : null;
  const structure = error instanceof StructureInputError ? error.detail : null;
  return {
    ok: false,
    diagnostics: [
      {
        code: sprite ? sprite.code : structure ? structure.code : 'workspace.compile',
        file: sprite ? sprite.file : structure ? structure.file : '.ashfoxworkspace',
        message: error instanceof Error ? error.message : String(error),
      },
    ],
  };
};

const compileDirectory = (
  configuration: string,
  files: readonly DirectoryFile[],
): DirectoryCompilation => {
  const config = readDirectoryWorkspace(configuration);
  assertSourceBudget(files);
  const filesByPath = declaredFiles(config, files);
  const entries = declaredEntries(config);
  validateCanonicalLayout(
    config,
    filesByPath,
    entries.map((e) => e.path),
  );
  const output = compileEntries(entries, filesByPath);
  if ('ok' in output) return output;
  compileModels(config, files, output);
  const productsByEntry = new Map(
    output.products.map((product) => [entryKey(product.entry), product]),
  );
  assertExports(config, productsByEntry);
  assertPackSounds(config, productsByEntry);
  const products = output.products.sort(productOrder);
  const sourceHash = sha256Digest(
    JSON.stringify(
      ordered({ config, files: [...files].sort((a, b) => (a.path < b.path ? -1 : 1)) }),
    ),
  );
  const buildKey = sha256Digest(
    sourceHash +
      SPRITE_POLICY +
      AUDIO_POLICY +
      ASHFOX_WORKSPACE_COMPILER_FINGERPRINT +
      ':directory-v2',
  );
  return { ok: true, config, sourceHash, buildKey, products: Object.freeze(products) };
};

export const compileDirectoryWorkspace = (
  configuration: string,
  files: readonly DirectoryFile[],
): DirectoryCompilation => {
  try {
    return compileDirectory(configuration, files);
  } catch (error) {
    return compileFailure(error);
  }
};
