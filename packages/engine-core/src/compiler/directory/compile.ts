import { AUDIO_POLICY, type SoundProduct } from '@ashfox/audio-core';
import { compareText } from '@ashfox/internal-contracts';
import { canonicalJsonString } from '../../canonicalJson';
import {
  validateAssetDeclarations,
  type AssetDeclarations,
} from '../../project/directory/declarations';
import { readDirectoryWorkspace } from '../../project/directory/read';
import type { DirectoryFile, DirectoryWorkspace } from '../../project/directory/contract';
import { lexProgramSource } from '../../project/program/syntax/lex';
import {
  assertSourceBudget,
  declaredEntries,
  declaredFiles,
  entryKey,
  sortDirectoryProducts,
  type DirectoryEntry as Entry,
} from './checks';
import { compilePreparedSound, prepareDirectorySound } from './sound';
import { validateCanonicalLayout } from './layout';
import { compileDirectorySprite } from './sprite';
import { compileDirectoryStructure } from './structure';
import { compileDirectoryVfx } from './vfx';
import { createDirectoryWorkspaceCache, type DirectoryWorkspaceCache } from './cache';
import { withStructureTileTextureCache } from '../structure/atlas';
import type { SpriteProduct } from '../sprite/contract';
import type { StructureAuditEvaluator, StructureProduct } from '../structure/contract';
import type { CompiledVfx, VfxRecipe } from '../../vfx/contract';
import type { BedrockParticleSpec, VfxRuntimeSpec } from '../../vfx/specEmit';
import { VfxInputError } from '../../project/vfx/contract';
import { parseVfxSource } from '../../project/vfx/source';
import { StructureInputError } from '../../project/structure';
import { sha256Digest } from '../../provenance/digest';
import { SPRITE_POLICY, SpriteInputError } from '../../project/sprite/contract';
import {
  ASHFOX_WORKSPACE_COMPILER_FINGERPRINT,
  type AuthoredAssetWorkspace,
  type WorkspaceEntrySelector,
} from '../../project/workspace';
import type { AssetAuthoringTelemetry } from '../program/asset/texture/telemetry';
import type { SpriteSourceUnit } from '../../project/sprite/source';
import type { CompiledModel } from '../../model/compiled';
import {
  assertSoundWorkspaceBudget,
  checkDirectoryModularity,
  directoryCompilationExportsCheck,
  resolveDirectoryHooks,
} from './hooks';
import { compileModels } from './models';

interface EntryProductBase {
  readonly entry: WorkspaceEntrySelector;
  readonly sourcePath: string;
  readonly declarations: AssetDeclarations;
  readonly hooks?: import('../../hooks/contract').HooksDocument;
}

export type DirectoryProduct = EntryProductBase &
  (
    | { readonly kind: 'sprite'; readonly sprite: SpriteProduct }
    | {
        readonly kind: 'model';
        readonly model: CompiledModel;
        readonly workspace: AuthoredAssetWorkspace;
        readonly telemetry?: AssetAuthoringTelemetry;
      }
    | { readonly kind: 'sound'; readonly sounds: readonly SoundProduct[] }
    | { readonly kind: 'structure'; readonly structure: StructureProduct }
    | {
        readonly kind: 'vfx';
        readonly vfx: CompiledVfx;
        readonly recipe: VfxRecipe;
        readonly glb: Uint8Array;
        readonly spec: VfxRuntimeSpec;
        readonly particles: readonly BedrockParticleSpec[];
      }
  );
type DirectoryDiagnostic = {
  readonly code: string;
  readonly file: string;
  readonly message: string;
  readonly hint?: string;
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
export type DirectoryFailure = Extract<DirectoryCompilation, { readonly ok: false }>;
type PreparedSound = ReturnType<typeof prepareDirectorySound>;
type Files = ReadonlyMap<string, DirectoryFile>;

/** Mutable product accumulator shared by the entry compilers. */
interface EntryOutput {
  readonly products: DirectoryProduct[];
  readonly nonModelPaths: Set<string>;
  readonly structureCustomPaths: Set<string>;
  readonly modelEntries: Entry[];
}

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
    assertSoundWorkspaceBudget(e.path, prepared.size, total);
  }
  return prepared;
};

const compileSpriteEntry = (
  e: Entry,
  filesByPath: Files,
  cache: DirectoryWorkspaceCache | undefined,
  output: EntryOutput,
): DirectoryFailure | null => {
  const spriteUnits = cache?.spriteUnits ?? new Map<string, SpriteSourceUnit>();
  const compiled = compileDirectorySprite(filesByPath, e.path, spriteUnits, cache);
  if (!compiled.result.ok)
    return {
      ok: false,
      diagnostics: compiled.result.diagnostics.map((d) => ({
        code: d.code,
        file: d.file,
        message: d.pointer + ': ' + d.expected + '; ' + d.actual,
        ...(d.hint !== undefined ? { hint: d.hint } : {}),
      })),
    };
  const sprite = compiled.result.products[0]!;
  if (sprite.id !== e.entry.entryName)
    throw new Error('Entry name must match sprite id: ' + e.path);
  const unit = spriteUnits.get(e.path)!;
  const declarations = validateAssetDeclarations('sprite', unit.outputs, unit.previews, e.path);
  const resolvedHooks = resolveDirectoryHooks(e.path, filesByPath, output.nonModelPaths);
  if (resolvedHooks.failure) return resolvedHooks.failure;
  output.products.push({
    kind: 'sprite',
    entry: e.entry,
    sourcePath: e.path,
    sprite,
    declarations,
    ...(resolvedHooks.hooks ? { hooks: resolvedHooks.hooks } : {}),
  });
  compiled.paths.forEach((p) => output.nonModelPaths.add(p));
  return null;
};

const compileSoundEntry = (
  e: Entry,
  prepared: PreparedSound,
  filesByPath: Files,
  output: EntryOutput,
): DirectoryFailure | null => {
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
  const resolvedHooks = resolveDirectoryHooks(e.path, filesByPath, output.nonModelPaths);
  if (resolvedHooks.failure) return resolvedHooks.failure;
  output.products.push({
    kind: 'sound',
    entry: e.entry,
    sourcePath: e.path,
    sounds: compiled.sounds,
    declarations,
    ...(resolvedHooks.hooks ? { hooks: resolvedHooks.hooks } : {}),
  });
  compiled.soundPaths.forEach((p) => output.nonModelPaths.add(p));
  return null;
};

const compileStructureEntry = (
  e: Entry,
  filesByPath: Files,
  output: EntryOutput,
  evaluateStructureAudit: StructureAuditEvaluator,
  cache?: DirectoryWorkspaceCache,
): void => {
  const result = compileDirectoryStructure(filesByPath, e.path, evaluateStructureAudit, cache);
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
  result.structurePaths.forEach((p) => output.nonModelPaths.add(p));
  result.customPaths.forEach((p) => output.structureCustomPaths.add(p));
};

const entryTopKind = (
  filePath: string,
  filesByPath: Files,
  cache?: DirectoryWorkspaceCache,
): string | undefined => {
  if (cache?.topKinds.has(filePath)) return cache.topKinds.get(filePath);
  const kind = lexProgramSource(filesByPath.get(filePath)!.source).tokens[2]?.value;
  cache?.topKinds.set(filePath, kind);
  return kind;
};

const compileVfxEntry = (e: Entry, filesByPath: Files, output: EntryOutput): void => {
  const unit = parseVfxSource(filesByPath.get(e.path)!.source, e.path);
  const bundle = compileDirectoryVfx(filesByPath, e.path);
  if (bundle.compiled.name !== e.entry.entryName) {
    throw new Error('Entry name must match vfx id: ' + e.path);
  }
  const declarations = validateAssetDeclarations('vfx', unit.outputs, unit.previews, e.path);
  output.products.push({
    kind: 'vfx',
    entry: e.entry,
    sourcePath: e.path,
    vfx: bundle.compiled,
    recipe: bundle.recipe,
    glb: bundle.glb,
    spec: bundle.spec,
    particles: bundle.particles,
    declarations,
  });
  bundle.paths.forEach((p) => output.nonModelPaths.add(p));
};

const runEntryLoop = (
  entries: readonly Entry[],
  kinds: ReadonlyMap<string, string | undefined>,
  filesByPath: Files,
  evaluateStructureAudit: StructureAuditEvaluator,
  cache: DirectoryWorkspaceCache | undefined,
): EntryOutput | DirectoryFailure => {
  const preparedSounds = prepareSoundEntries(entries, kinds, filesByPath);
  const output: EntryOutput = {
    products: [],
    nonModelPaths: new Set(),
    structureCustomPaths: new Set(),
    modelEntries: [],
  };
  for (const e of entries) {
    const kind = kinds.get(e.path);
    if (kind === 'sprite') {
      const failure = compileSpriteEntry(e, filesByPath, cache, output);
      if (failure) return failure;
    } else if (kind === 'sound') {
      const failure = compileSoundEntry(e, preparedSounds.get(e.path)!, filesByPath, output);
      if (failure) return failure;
    } else if (kind === 'structure' || kind === 'compound')
      compileStructureEntry(e, filesByPath, output, evaluateStructureAudit, cache);
    else if (kind === 'vfx') compileVfxEntry(e, filesByPath, output);
    else output.modelEntries.push(e);
  }
  return output;
};

/** Compiles sprite, structure, and sound entries in declaration order and defers models. */
const compileEntries = (
  entries: readonly Entry[],
  filesByPath: Files,
  evaluateStructureAudit: StructureAuditEvaluator,
  cache?: DirectoryWorkspaceCache,
): EntryOutput | DirectoryFailure => {
  const kinds = new Map(entries.map((e) => [e.path, entryTopKind(e.path, filesByPath, cache)]));
  return cache
    ? withStructureTileTextureCache(cache.tileTextures, () =>
        runEntryLoop(entries, kinds, filesByPath, evaluateStructureAudit, cache),
      )
    : runEntryLoop(entries, kinds, filesByPath, evaluateStructureAudit, undefined);
};

const formatFailureDetail = (error: unknown): { code: string; file: string; hint?: string } => {
  if (error instanceof SpriteInputError) return error.diagnostic;
  if (error instanceof StructureInputError) return error.detail;
  if (error instanceof VfxInputError) return error.diagnostic;
  const hint =
    error instanceof Error && 'hint' in error && typeof error.hint === 'string'
      ? error.hint
      : undefined;
  return {
    code: 'workspace.compile',
    file: '.ashfoxworkspace',
    ...(hint !== undefined ? { hint } : {}),
  };
};

const compileFailure = (error: unknown): DirectoryFailure => {
  const detail = formatFailureDetail(error);
  const hint = detail.hint;
  return {
    ok: false,
    diagnostics: [
      {
        code: detail.code,
        file: detail.file,
        message: error instanceof Error ? error.message : String(error),
        ...(hint !== undefined ? { hint } : {}),
      },
    ],
  };
};

const compileDirectory = (
  configuration: string,
  files: readonly DirectoryFile[],
  evaluateStructureAudit: StructureAuditEvaluator,
  useCache: boolean,
): DirectoryCompilation => {
  const config = readDirectoryWorkspace(configuration);
  assertSourceBudget(files);
  const filesByPath = declaredFiles(config, files);
  const entries = declaredEntries(config);
  const cache = useCache ? createDirectoryWorkspaceCache() : undefined;
  validateCanonicalLayout(
    config,
    filesByPath,
    entries.map((e) => e.path),
    cache,
  );
  const modFailure = checkDirectoryModularity(files);
  if (modFailure) return modFailure;
  const output = compileEntries(entries, filesByPath, evaluateStructureAudit, cache);
  if ('ok' in output) return output;
  const modelFailure = compileModels(config, files, filesByPath, output, cache);
  if (modelFailure) return modelFailure;
  const productsByEntry = new Map(
    output.products.map((product) => [entryKey(product.entry), product]),
  );
  directoryCompilationExportsCheck(
    config,
    productsByEntry,
    (entry) => {
      const p = productsByEntry.get(entryKey(entry));
      return p?.kind === 'sound' ? p.sounds : undefined;
    },
    entryKey,
  );
  const products = sortDirectoryProducts(output.products);
  const sourceHash = sha256Digest(
    canonicalJsonString({
      config,
      files: [...files].sort((a, b) => compareText(a.path, b.path)),
    }),
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
  evaluateStructureAudit: StructureAuditEvaluator,
  useCache = true,
): DirectoryCompilation => {
  try {
    return compileDirectory(configuration, files, evaluateStructureAudit, useCache);
  } catch (error) {
    return compileFailure(error);
  }
};
