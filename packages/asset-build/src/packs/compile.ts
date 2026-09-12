import type { DirectoryPack } from '@ashfox/engine-core';
import type { Artifact, CatalogAsset, PackEncoder } from '../bundle/contract';
import { compileJavaPack } from './minecraft/compile';
import { compileGamePack } from './game/compile';
export type { PackEncoder } from '../bundle/contract';
export const compilePack = (
  pack: DirectoryPack,
  assets: readonly CatalogAsset[],
  artifacts: readonly Artifact[],
  encoder?: PackEncoder,
): Promise<readonly Artifact[]> =>
  pack.format === 'minecraft_java'
    ? compileJavaPack(pack, assets, artifacts, encoder)
    : compileGamePack(pack, assets, artifacts, encoder);
