import type { SoundProduct } from '@ashfox/audio-core';
import type { HooksDocument } from '../../hooks/contract';
import type { CompiledModel } from '../../model/compiled';
import {
  validateAssetDeclarations,
  type AssetDeclarations,
  type RawDeclaredOutput,
  type RawDeclaredPreview,
} from '../../project/directory/declarations';
import type { DirectoryFile } from '../../project/directory/contract';
import { SpriteInputError } from '../../project/sprite/contract';
import type { SpriteSourceUnit } from '../../project/sprite/source';
import { StructureInputError } from '../../project/structure';
import { VfxInputError } from '../../project/vfx/contract';
import { parseVfxSource } from '../../project/vfx/source';
import type { AuthoredAssetWorkspace, WorkspaceEntrySelector } from '../../project/workspace';
import type { CompiledVfx, VfxRecipe } from '../../vfx/contract';
import type { BedrockParticleSpec, VfxRuntimeSpec } from '../../vfx/specEmit';
import type { AssetAuthoringTelemetry } from '../program/asset/texture/telemetry';
import type { SpriteProduct } from '../sprite/contract';
import type { StructureAuditEvaluator, StructureProduct } from '../structure/contract';
import type { DirectoryWorkspaceCache } from './cache';
import type { DirectoryEntry } from './checks';
import { assertSoundWorkspaceBudget, resolveDirectoryHooks, type DirectoryFailure } from './hooks';
import { compilePreparedSound, prepareDirectorySound } from './sound';
import { compileDirectorySprite } from './sprite';
import { compileDirectoryStructure } from './structure';
import { compileDirectoryVfx } from './vfx';

interface EntryProductBase {
  readonly entry: WorkspaceEntrySelector;
  readonly sourcePath: string;
  readonly declarations: AssetDeclarations;
  readonly hooks?: HooksDocument;
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

export interface DirectoryDiagnostic {
  readonly code: string;
  readonly file: string;
  readonly message: string;
  readonly hint?: string;
}

export interface EntryOutput {
  readonly products: DirectoryProduct[];
  readonly nonModelPaths: Set<string>;
  readonly structureCustomPaths: Set<string>;
  readonly modelEntries: DirectoryEntry[];
}

export type DomainEntryKind = 'sprite' | 'sound' | 'structure' | 'vfx';

type Files = ReadonlyMap<string, DirectoryFile>;
type PreparedSound = ReturnType<typeof prepareDirectorySound>;

interface DomainCompileContext {
  readonly filesByPath: Files;
  readonly cache?: DirectoryWorkspaceCache;
  readonly evaluateStructureAudit: StructureAuditEvaluator;
  readonly preparedSounds: ReadonlyMap<string, PreparedSound>;
  readonly nonModelPaths: Set<string>;
}

type DomainCompiledOutcome =
  | { readonly ok: false; readonly diagnostics: readonly DirectoryDiagnostic[] }
  | {
      readonly ok: true;
      readonly id: string;
      readonly outputs: readonly RawDeclaredOutput[];
      readonly previews: readonly RawDeclaredPreview[];
      readonly resolveHooks?: boolean;
      readonly nonModelPaths: Iterable<string>;
      readonly structureCustomPaths?: Iterable<string>;
      readonly toProduct: (
        entry: WorkspaceEntrySelector,
        sourcePath: string,
        declarations: AssetDeclarations,
        hooks?: HooksDocument,
      ) => DirectoryProduct;
    };

export interface DomainEntryCompiler {
  readonly kind: DomainEntryKind;
  readonly compile: (entry: DirectoryEntry, ctx: DomainCompileContext) => DomainCompiledOutcome;
}

export const resolveDomainKind = (topKind: string | undefined): DomainEntryKind | undefined => {
  if (topKind === 'sprite' || topKind === 'sound' || topKind === 'vfx') return topKind;
  if (topKind === 'structure' || topKind === 'compound') return 'structure';
  return undefined;
};

const prepareSoundEntries = (
  entries: readonly DirectoryEntry[],
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

export const createDomainCompileContext = (
  entries: readonly DirectoryEntry[],
  kinds: ReadonlyMap<string, string | undefined>,
  filesByPath: Files,
  evaluateStructureAudit: StructureAuditEvaluator,
  nonModelPaths: Set<string>,
  cache?: DirectoryWorkspaceCache,
): DomainCompileContext => ({
  filesByPath,
  cache,
  evaluateStructureAudit,
  preparedSounds: prepareSoundEntries(entries, kinds, filesByPath),
  nonModelPaths,
});

const compileSpriteDomain = (
  entry: DirectoryEntry,
  ctx: DomainCompileContext,
): DomainCompiledOutcome => {
  const spriteUnits = ctx.cache?.spriteUnits ?? new Map<string, SpriteSourceUnit>();
  const compiled = compileDirectorySprite(ctx.filesByPath, entry.path, spriteUnits, ctx.cache);
  if (!compiled.result.ok) {
    return {
      ok: false,
      diagnostics: compiled.result.diagnostics.map((d) => ({
        code: d.code,
        file: d.file,
        message: d.pointer + ': ' + d.expected + '; ' + d.actual,
        ...(d.hint !== undefined ? { hint: d.hint } : {}),
      })),
    };
  }
  const sprite = compiled.result.products[0]!;
  const unit = spriteUnits.get(entry.path)!;
  return {
    ok: true,
    id: sprite.id,
    outputs: unit.outputs,
    previews: unit.previews,
    resolveHooks: true,
    nonModelPaths: compiled.paths,
    toProduct: (selector, sourcePath, declarations, hooks) => ({
      kind: 'sprite',
      entry: selector,
      sourcePath,
      sprite,
      declarations,
      ...(hooks ? { hooks } : {}),
    }),
  };
};

const compileSoundDomain = (
  entry: DirectoryEntry,
  ctx: DomainCompileContext,
): DomainCompiledOutcome => {
  const compiled = compilePreparedSound(ctx.preparedSounds.get(entry.path)!, entry.path);
  return {
    ok: true,
    id: compiled.unit.id,
    outputs: compiled.unit.outputs,
    previews: compiled.unit.previews,
    resolveHooks: true,
    nonModelPaths: compiled.soundPaths,
    toProduct: (selector, sourcePath, declarations, hooks) => ({
      kind: 'sound',
      entry: selector,
      sourcePath,
      sounds: compiled.sounds,
      declarations,
      ...(hooks ? { hooks } : {}),
    }),
  };
};

const compileStructureDomain = (
  entry: DirectoryEntry,
  ctx: DomainCompileContext,
): DomainCompiledOutcome => {
  const result = compileDirectoryStructure(
    ctx.filesByPath,
    entry.path,
    ctx.evaluateStructureAudit,
    ctx.cache,
  );
  return {
    ok: true,
    id: result.structure.id,
    outputs: result.rootUnit.outputs,
    previews: result.rootUnit.previews,
    nonModelPaths: result.structurePaths,
    structureCustomPaths: result.customPaths,
    toProduct: (selector, sourcePath, declarations) => ({
      kind: 'structure',
      entry: selector,
      sourcePath,
      structure: result.structure,
      declarations,
    }),
  };
};

const compileVfxDomain = (
  entry: DirectoryEntry,
  ctx: DomainCompileContext,
): DomainCompiledOutcome => {
  const unit = parseVfxSource(ctx.filesByPath.get(entry.path)!.source, entry.path);
  const bundle = compileDirectoryVfx(ctx.filesByPath, entry.path);
  return {
    ok: true,
    id: bundle.compiled.name,
    outputs: unit.outputs,
    previews: unit.previews,
    nonModelPaths: bundle.paths,
    toProduct: (selector, sourcePath, declarations) => ({
      kind: 'vfx',
      entry: selector,
      sourcePath,
      vfx: bundle.compiled,
      recipe: bundle.recipe,
      glb: bundle.glb,
      spec: bundle.spec,
      particles: bundle.particles,
      declarations,
    }),
  };
};

export const DOMAIN_ENTRY_COMPILERS: Readonly<Record<DomainEntryKind, DomainEntryCompiler>> =
  Object.freeze({
    sprite: { kind: 'sprite', compile: compileSpriteDomain },
    sound: { kind: 'sound', compile: compileSoundDomain },
    structure: { kind: 'structure', compile: compileStructureDomain },
    vfx: { kind: 'vfx', compile: compileVfxDomain },
  });

/** Template pipeline normalizing compilation, id/declaration checks, hooks, and outputs. */
export const runDomainEntry = (
  compiler: DomainEntryCompiler,
  entry: DirectoryEntry,
  ctx: DomainCompileContext,
  output: EntryOutput,
): DirectoryFailure | null => {
  const outcome = compiler.compile(entry, ctx);
  if (!outcome.ok) return { ok: false, diagnostics: outcome.diagnostics };
  if (outcome.id !== entry.entry.entryName) {
    throw new Error(`Entry name must match ${compiler.kind} id: ${entry.path}`);
  }
  const declarations = validateAssetDeclarations(
    compiler.kind,
    outcome.outputs,
    outcome.previews,
    entry.path,
  );
  let hooks: HooksDocument | undefined;
  if (outcome.resolveHooks) {
    const resolvedHooks = resolveDirectoryHooks(entry.path, ctx.filesByPath, ctx.nonModelPaths);
    if (resolvedHooks.failure) return resolvedHooks.failure;
    hooks = resolvedHooks.hooks;
  }
  output.products.push(outcome.toProduct(entry.entry, entry.path, declarations, hooks));
  for (const p of outcome.nonModelPaths) output.nonModelPaths.add(p);
  if (outcome.structureCustomPaths) {
    for (const p of outcome.structureCustomPaths) output.structureCustomPaths.add(p);
  }
  return null;
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

/** Normalizes domain and workspace compile exceptions into closed directory diagnostics. */
export const compileFailure = (error: unknown): DirectoryFailure => {
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
