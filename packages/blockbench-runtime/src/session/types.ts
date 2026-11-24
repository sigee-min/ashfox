import type {
  FormatKind,
  MeshUvPolicy as ContractMeshUvPolicy,
  TrackedAnimation as ContractTrackedAnimation,
  TrackedAnimationChannel as ContractTrackedAnimationChannel,
  TrackedAnimationTrigger as ContractTrackedAnimationTrigger,
  TrackedBone as ContractTrackedBone,
  TrackedCube as ContractTrackedCube,
  TrackedCubeFace as ContractTrackedCubeFace,
  TrackedMesh as ContractTrackedMesh,
  TrackedMeshFace as ContractTrackedMeshFace,
  TrackedMeshFaceUv as ContractTrackedMeshFaceUv,
  TrackedMeshVertex as ContractTrackedMeshVertex,
  TrackedTexture as ContractTrackedTexture,
} from '@ashfox/blockbench-contracts/types/internal';
import type {
  TextureFrameOrderType,
  TextureMeta,
  TexturePbrChannel,
  TextureRenderMode,
  TextureRenderSides,
} from '@ashfox/blockbench-contracts/types/texture';
import type { AnimationTimePolicy } from '../domain/animation/timePolicy';

type MutableContract<T> = T extends readonly unknown[]
  ? { -readonly [TKey in keyof T]: MutableContract<T[TKey]> }
  : T extends object
    ? { -readonly [TKey in keyof T]: MutableContract<T[TKey]> }
    : T;

export type MeshUvPolicy = MutableContract<ContractMeshUvPolicy>;
export type TrackedBone = MutableContract<ContractTrackedBone>;
export type TrackedCube = MutableContract<ContractTrackedCube>;
export type TrackedCubeFace = MutableContract<ContractTrackedCubeFace>;
export type TrackedMeshVertex = MutableContract<ContractTrackedMeshVertex>;
export type TrackedMeshFaceUv = MutableContract<ContractTrackedMeshFaceUv>;
export type TrackedMeshFace = MutableContract<ContractTrackedMeshFace>;
export type TrackedMesh = MutableContract<ContractTrackedMesh>;
export type TrackedTexture = MutableContract<ContractTrackedTexture>;
export type TrackedAnimationChannel = MutableContract<ContractTrackedAnimationChannel>;
export type TrackedAnimationTrigger = MutableContract<ContractTrackedAnimationTrigger>;
export type TrackedAnimation = MutableContract<ContractTrackedAnimation>;

export type BoneUpdate = {
  id?: string;
  newName?: string;
  parent?: string | null;
  pivot?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  visibility?: boolean;
};

export type CubeUpdate = {
  id?: string;
  newName?: string;
  bone?: string;
  from?: [number, number, number];
  to?: [number, number, number];
  origin?: [number, number, number];
  rotation?: [number, number, number];
  uv?: [number, number];
  uvOffset?: [number, number];
  inflate?: number;
  mirror?: boolean;
  visibility?: boolean;
  boxUv?: boolean;
};

export type MeshUpdate = {
  id?: string;
  newName?: string;
  bone?: string | null;
  origin?: [number, number, number];
  rotation?: [number, number, number];
  visibility?: boolean;
  uvPolicy?: MeshUvPolicy;
  vertices?: TrackedMeshVertex[];
  faces?: TrackedMeshFace[];
};

export type TextureUpdate = {
  id?: string;
  newName?: string;
  path?: string;
  width?: number;
  height?: number;
  contentHash?: string;
  namespace?: TextureMeta['namespace'];
  folder?: TextureMeta['folder'];
  particle?: TextureMeta['particle'];
  visible?: TextureMeta['visible'];
  renderMode?: TextureRenderMode;
  renderSides?: TextureRenderSides;
  pbrChannel?: TexturePbrChannel;
  group?: TextureMeta['group'];
  frameTime?: TextureMeta['frameTime'];
  frameOrderType?: TextureFrameOrderType;
  frameOrder?: TextureMeta['frameOrder'];
  frameInterpolate?: TextureMeta['frameInterpolate'];
  internal?: TextureMeta['internal'];
  keepSize?: TextureMeta['keepSize'];
};

export type AnimationUpdate = {
  id?: string;
  newName?: string;
  length?: number;
  loop?: boolean;
  fps?: number;
};

export interface SessionState {
  id: string | null;
  format: FormatKind | null;
  formatId?: string | null;
  name: string | null;
  dirty?: boolean;
  uvPixelsPerBlock?: number;
  bones: TrackedBone[];
  cubes: TrackedCube[];
  meshes?: TrackedMesh[];
  textures: TrackedTexture[];
  animations: TrackedAnimation[];
  animationsStatus?: 'available' | 'unavailable';
  animationTimePolicy: AnimationTimePolicy;
}
