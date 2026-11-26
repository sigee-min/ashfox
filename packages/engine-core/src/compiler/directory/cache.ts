import type { CompiledModel } from '../../model/compiled';
import type { TextureAsset } from '../../model/texture';
import type { NativeSourceMetadata } from '../../project/directory/source';
import type { AssetSourceParseResult } from '../../project/program/asset/contract';
import type { SpriteSourceUnit } from '../../project/sprite/source';
import type { StructureSourceUnit } from '../../project/structure';
import type { EvaluatedStructureResult } from '../structure/contract';

export interface CachedCustomModel {
  readonly model: CompiledModel;
  readonly closurePaths: readonly string[];
}

export interface SpriteModuleLookup {
  readonly importTargets: ReadonlyMap<string, string>;
  readonly declIds: Readonly<Record<'masks' | 'materials' | 'stamps', ReadonlySet<string>>>;
  readonly exported: Readonly<
    Record<'masks' | 'materials' | 'stamps', readonly Record<string, unknown>[]>
  >;
}

export interface DirectoryWorkspaceCache {
  readonly topKinds: Map<string, string | undefined>;
  readonly inspected: Map<string, NativeSourceMetadata>;
  readonly structureUnits: Map<string, StructureSourceUnit>;
  readonly spriteUnits: Map<string, SpriteSourceUnit>;
  readonly assetUnits: Map<string, AssetSourceParseResult>;
  readonly customModels: Map<string, CachedCustomModel>;
  readonly evaluatedGrids: Map<string, EvaluatedStructureResult>;
  readonly tileTextures: Map<string, TextureAsset>;
  readonly spriteLookups: Map<string, SpriteModuleLookup>;
  readonly spriteSymbols: Map<string, string>;
}

/** Creates per-workspace caches shared across directory compilation stages. */
export const createDirectoryWorkspaceCache = (): DirectoryWorkspaceCache => ({
  topKinds: new Map(),
  inspected: new Map(),
  structureUnits: new Map(),
  spriteUnits: new Map(),
  assetUnits: new Map(),
  customModels: new Map(),
  evaluatedGrids: new Map(),
  tileTextures: new Map(),
  spriteLookups: new Map(),
  spriteSymbols: new Map(),
});
