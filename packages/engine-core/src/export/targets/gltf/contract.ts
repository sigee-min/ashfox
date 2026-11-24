import type { Gltf2ExportProfile } from '../../adapter/contract';

export interface GltfAsset {
  version: Gltf2ExportProfile['version'];
  generator: string;
  copyright?: string;
}

export interface GltfBuffer {
  byteLength: number;
  uri?: string;
}

export interface GltfBufferView {
  buffer: number;
  byteOffset: number;
  byteLength: number;
  byteStride?: number;
  target?: 34962 | 34963;
  extensions?: {
    EXT_meshopt_compression: {
      buffer: number;
      byteOffset: number;
      byteLength: number;
      byteStride: number;
      count: number;
      mode: 'ATTRIBUTES' | 'TRIANGLES' | 'INDICES';
      filter?: 'NONE' | 'OCTAHEDRAL' | 'QUATERNION' | 'EXPONENTIAL';
    };
  };
}

export interface GltfAccessor {
  bufferView: number;
  byteOffset?: number;
  componentType: 5121 | 5122 | 5123 | 5125 | 5126;
  normalized?: boolean;
  count: number;
  type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4';
  min?: number[];
  max?: number[];
}

export interface GltfPrimitive {
  attributes: {
    POSITION: number;
    NORMAL?: number;
    TEXCOORD_0?: number;
    JOINTS_0?: number;
    WEIGHTS_0?: number;
  };
  indices?: number;
  material?: number;
  mode?: 4;
  /** Canonical workspace-authored node for an unmerged primitive. The
   * field is intentionally absent on merged interchange batches, where
   * primitive ownership is not part of the source contract. */
  extras?: {
    ashfoxSourceNodeId: string;
  };
}

export interface GltfMesh {
  name?: string;
  primitives: GltfPrimitive[];
}

export interface GltfNode {
  name?: string;
  mesh?: number;
  skin?: number;
  children?: number[];
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
  extras?: {
    ashfoxId: string;
    ashfoxKind: 'bone' | 'cube' | 'plane' | 'locator';
    visible: boolean;
    ashfoxTags?: string[];
  };
}

export interface GltfSkin {
  name?: string;
  inverseBindMatrices?: number;
  skeleton?: number;
  joints: number[];
}

export interface GltfExternalImage {
  uri: string;
  mimeType?: string;
  name?: string;
}

export interface GltfEmbeddedImage {
  bufferView: number;
  mimeType: 'image/png' | 'image/jpeg';
  name?: string;
}

export type GltfImage = GltfExternalImage | GltfEmbeddedImage;

export interface GltfTexture {
  sampler?: number;
  source: number;
  name?: string;
}

export interface GltfSampler {
  magFilter: 9728 | 9729;
  minFilter: 9728 | 9729;
  wrapS: 10497;
  wrapT: 10497;
}

export interface GltfMaterial {
  name?: string;
  pbrMetallicRoughness: {
    baseColorTexture?: { index: number };
    metallicFactor: 0;
    roughnessFactor: 1;
  };
  emissiveTexture?: { index: number };
  emissiveFactor?: [number, number, number];
  alphaMode?: 'MASK' | 'BLEND';
  alphaCutoff?: number;
  doubleSided?: boolean;
}

export interface GltfAnimationSampler {
  input: number;
  output: number;
  interpolation?: 'LINEAR' | 'STEP';
}

export interface GltfAnimationChannel {
  sampler: number;
  target: {
    node: number;
    path: 'translation' | 'rotation' | 'scale';
  };
}

export interface GltfAnimation {
  name?: string;
  samplers: GltfAnimationSampler[];
  channels: GltfAnimationChannel[];
  extras?: {
    ashfoxLoop: 'once' | 'loop' | 'hold_on_last_frame';
    ashfoxDurationSeconds: number;
    ashfoxFps: number;
  };
}

export interface GltfDocument {
  asset: GltfAsset;
  extensionsUsed?: Array<'EXT_meshopt_compression' | 'KHR_mesh_quantization'>;
  extensionsRequired?: Array<'EXT_meshopt_compression' | 'KHR_mesh_quantization'>;
  scene: 0;
  scenes: Array<{ name?: string; nodes: number[] }>;
  nodes: GltfNode[];
  buffers?: GltfBuffer[];
  bufferViews?: GltfBufferView[];
  accessors?: GltfAccessor[];
  meshes?: GltfMesh[];
  skins?: GltfSkin[];
  images?: GltfImage[];
  samplers?: GltfSampler[];
  textures?: GltfTexture[];
  materials?: GltfMaterial[];
  animations?: GltfAnimation[];
}
