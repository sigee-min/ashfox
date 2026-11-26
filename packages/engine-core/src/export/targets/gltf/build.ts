import type { HooksDocument } from '../../../hooks/contract';
import type { AssetId } from '../../../model';
import type { ResolvedBlob } from '../../contract';
import type { MaterializedTextureFile } from '../../texture';
import type { GltfDocument } from './contract';

export interface GltfBuildOptions {
  readonly quantize?: boolean;
  readonly includeLods?: boolean;
  readonly hooks?: HooksDocument;
  resolvedTextures?: ReadonlyMap<AssetId, ResolvedBlob>;
}

export interface CompiledGltf {
  document: GltfDocument;
  binary: Uint8Array;
  textureFiles: MaterializedTextureFile[];
}
