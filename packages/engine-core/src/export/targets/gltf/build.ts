import type { AssetId } from '../../../model';
import type {
  ResolvedBlob
} from '../../contract';
import type { MaterializedTextureFile } from '../../texture';
import type { GltfDocument } from './contract';

export interface GltfBuildOptions {
  readonly quantize?: boolean;
  resolvedTextures?: ReadonlyMap<AssetId, ResolvedBlob>;
}

export interface CompiledGltf {
  document: GltfDocument;
  binary: Uint8Array;
  textureFiles: MaterializedTextureFile[];
}
