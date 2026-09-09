import type { DirectoryPack } from '@ashfox/engine-core';
import type { Artifact, CatalogAsset, PackEncoder } from './contract';
import { compileJavaPack } from './minecraft';
import { compileGamePack } from './game';
export type { PackEncoder } from './contract';
export const compilePack = (pack: DirectoryPack, assets: readonly CatalogAsset[], artifacts: readonly Artifact[], encoder?: PackEncoder): Promise<readonly Artifact[]> =>
  pack.format === 'minecraft_java' ? compileJavaPack(pack, assets, artifacts, encoder) : compileGamePack(pack, assets, artifacts, encoder);
