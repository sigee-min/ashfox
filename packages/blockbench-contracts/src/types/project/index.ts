import type {
  TextureFrameOrderType,
  TextureMeta,
  TexturePbrChannel,
  TextureRenderMode,
  TextureRenderSides,
} from '../texture';
import type { CubeFaceDirection, FormatKind, ProjectStateDetail } from '../shared';
import type {
  TextureUsageCube,
  TextureUsageEntry,
  TextureUsageResult,
  TextureUsageUnresolved,
} from '../textureUsage';

export const MESH_SYMMETRY_AXES = Object.freeze(['none', 'x', 'y', 'z'] as const);
export type MeshSymmetryAxis = (typeof MESH_SYMMETRY_AXES)[number];
export const TRACKED_ANIMATION_CHANNELS = Object.freeze(['rot', 'pos', 'scale'] as const);
export type TrackedAnimationChannelName = (typeof TRACKED_ANIMATION_CHANNELS)[number];
export const TRACKED_ANIMATION_INTERPOLATIONS = Object.freeze([
  'linear',
  'step',
  'catmullrom',
] as const);
export type TrackedAnimationInterpolation = (typeof TRACKED_ANIMATION_INTERPOLATIONS)[number];
export const TRACKED_ANIMATION_TRIGGER_TYPES = Object.freeze([
  'sound',
  'particle',
  'timeline',
] as const);
export type TrackedAnimationTriggerType = (typeof TRACKED_ANIMATION_TRIGGER_TYPES)[number];

export type MeshUvPolicy = {
  readonly symmetryAxis?: MeshSymmetryAxis;
  readonly texelDensity?: number;
  readonly padding?: number;
};

export interface TrackedBone {
  readonly id?: string;
  readonly name: string;
  readonly parent?: string;
  readonly pivot: readonly [number, number, number];
  readonly rotation?: readonly [number, number, number];
  readonly scale?: readonly [number, number, number];
  readonly visibility?: boolean;
}

export interface TrackedCubeFace {
  readonly enabled: boolean;
  readonly texture?: string | false | null;
  readonly uv?: readonly [number, number, number, number];
  readonly rotation?: 0 | 90 | 180 | 270;
  readonly cullface?: CubeFaceDirection;
  readonly tintIndex?: number;
  readonly materialInstance?: string;
}

export interface TrackedCube {
  readonly id?: string;
  readonly name: string;
  readonly from: readonly [number, number, number];
  readonly to: readonly [number, number, number];
  readonly bone: string;
  readonly origin?: readonly [number, number, number];
  readonly rotation?: readonly [number, number, number];
  readonly uv?: readonly [number, number];
  readonly uvOffset?: readonly [number, number];
  readonly inflate?: number;
  readonly mirror?: boolean;
  readonly visibility?: boolean;
  readonly boxUv?: boolean;
  readonly shade?: boolean;
  readonly lightEmission?: number;
  readonly rescale?: boolean;
  readonly faces?: Readonly<Partial<Record<CubeFaceDirection, TrackedCubeFace>>>;
}

export interface TrackedMeshVertex {
  readonly id: string;
  readonly pos: readonly [number, number, number];
}

export interface TrackedMeshFaceUv {
  readonly vertexId: string;
  readonly uv: readonly [number, number];
}

export interface TrackedMeshFace {
  readonly id?: string;
  readonly vertices: readonly string[];
  readonly uv?: readonly TrackedMeshFaceUv[];
  readonly texture?: string | false;
}

export interface TrackedMesh {
  readonly id?: string;
  readonly name: string;
  readonly bone?: string;
  readonly origin?: readonly [number, number, number];
  readonly rotation?: readonly [number, number, number];
  readonly visibility?: boolean;
  readonly uvPolicy?: MeshUvPolicy;
  readonly vertices: readonly TrackedMeshVertex[];
  readonly faces: readonly TrackedMeshFace[];
}

export interface TrackedTexture {
  readonly id?: string;
  readonly name: string;
  readonly path?: string;
  readonly width?: number;
  readonly height?: number;
  readonly contentHash?: string;
  readonly namespace?: TextureMeta['namespace'];
  readonly folder?: TextureMeta['folder'];
  readonly particle?: TextureMeta['particle'];
  readonly visible?: TextureMeta['visible'];
  readonly renderMode?: TextureRenderMode;
  readonly renderSides?: TextureRenderSides;
  readonly pbrChannel?: TexturePbrChannel;
  readonly group?: TextureMeta['group'];
  readonly frameTime?: TextureMeta['frameTime'];
  readonly frameOrderType?: TextureFrameOrderType;
  readonly frameOrder?: TextureMeta['frameOrder'];
  readonly frameInterpolate?: TextureMeta['frameInterpolate'];
  readonly internal?: TextureMeta['internal'];
  readonly keepSize?: TextureMeta['keepSize'];
}

export interface TrackedAnimationChannel {
  readonly bone: string;
  readonly channel: TrackedAnimationChannelName;
  readonly keys: readonly {
    readonly time: number;
    readonly value: readonly [number, number, number];
    readonly interp?: TrackedAnimationInterpolation;
  }[];
}

export interface TrackedAnimationTrigger {
  readonly type: TrackedAnimationTriggerType;
  readonly keys: readonly {
    readonly time: number;
    readonly value: string | readonly string[] | Readonly<Record<string, unknown>>;
  }[];
}

export interface TrackedAnimation {
  readonly id?: string;
  readonly name: string;
  readonly length: number;
  readonly loop: boolean;
  readonly fps?: number;
  readonly channels?: readonly TrackedAnimationChannel[];
  readonly triggers?: readonly TrackedAnimationTrigger[];
}

export interface ProjectDiffCounts {
  readonly added: number;
  readonly removed: number;
  readonly changed: number;
}

export interface ProjectDiffCountsByKind {
  readonly bones: ProjectDiffCounts;
  readonly cubes: ProjectDiffCounts;
  readonly meshes?: ProjectDiffCounts;
  readonly textures: ProjectDiffCounts;
  readonly animations: ProjectDiffCounts;
}

export interface ProjectDiffEntry<T> {
  readonly key: string;
  readonly item: T;
}

export interface ProjectDiffChange<T> {
  readonly key: string;
  readonly before: T;
  readonly after: T;
}

export interface ProjectDiffSet<T> {
  readonly added: readonly ProjectDiffEntry<T>[];
  readonly removed: readonly ProjectDiffEntry<T>[];
  readonly changed: readonly ProjectDiffChange<T>[];
}

export interface ProjectDiff {
  readonly sinceRevision: string;
  readonly currentRevision: string;
  readonly baseMissing?: boolean;
  readonly counts: ProjectDiffCountsByKind;
  readonly bones?: ProjectDiffSet<TrackedBone>;
  readonly cubes?: ProjectDiffSet<TrackedCube>;
  readonly meshes?: ProjectDiffSet<TrackedMesh>;
  readonly textures?: ProjectDiffSet<TrackedTexture>;
  readonly animations?: ProjectDiffSet<TrackedAnimation>;
}

export interface ProjectState {
  readonly id: string;
  readonly active: boolean;
  readonly name: string | null;
  readonly format: FormatKind | null;
  readonly formatId?: string | null;
  readonly dirty?: boolean;
  readonly revision: string;
  readonly textureResolution?: {
    readonly width: number;
    readonly height: number;
  };
  readonly uvPixelsPerBlock?: number;
  readonly textureUsage?: ProjectTextureUsage;
  readonly counts: {
    readonly bones: number;
    readonly cubes: number;
    readonly meshes?: number;
    readonly meshVertices?: number;
    readonly meshFaces?: number;
    readonly textures: number;
    readonly animations: number;
  };
  readonly bones?: readonly TrackedBone[];
  readonly cubes?: readonly TrackedCube[];
  readonly meshes?: readonly TrackedMesh[];
  readonly textures?: readonly TrackedTexture[];
  readonly animations?: readonly TrackedAnimation[];
}

export type ProjectTextureUsageFace = TextureUsageCube['faces'][number];
export type ProjectTextureUsageCube = TextureUsageCube;
export type ProjectTextureUsageEntry = TextureUsageEntry;
export type ProjectTextureUsageUnresolved = TextureUsageUnresolved;
export type ProjectTextureUsage = TextureUsageResult;

export interface ProjectInfo {
  readonly id: string;
  readonly name: string | null;
  readonly format: FormatKind | null;
  readonly formatId?: string | null;
}

export type WithState<T> = T & {
  readonly state?: ProjectState | null;
  readonly diff?: ProjectDiff | null;
  readonly revision?: string;
};

export type { ProjectStateDetail };
