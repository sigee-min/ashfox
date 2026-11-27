import type { GltfBinaryWriter } from './binary';
import type { CubeFaceOcclusion } from '../../occlusion/cube';
import type { GltfMesh, GltfNode, GltfSkin } from './contract';

export interface GltfSceneCompileOptions {
  writer: GltfBinaryWriter;
  materialByTextureId: ReadonlyMap<string, number>;
  singleSidedMaterialByTextureId: ReadonlyMap<string, number>;
  normalMaterialIndices?: ReadonlySet<number>;
  unitScale: number;
  cubeFaceOcclusion?: CubeFaceOcclusion;
}

export interface GltfCompiledScene {
  nodes: GltfNode[];
  meshes: GltfMesh[];
  skins: GltfSkin[];
  rootNodeIndices: number[];
  nodeIndexById: Map<string, number>;
  restTranslationById: Map<string, [number, number, number]>;
  restRotationById: Map<string, [number, number, number]>;
  restScaleById: Map<string, [number, number, number]>;
}
