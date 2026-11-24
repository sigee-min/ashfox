import type { TextureOpLike } from '../../../domain/textureOps';
import type { TextureToolContext } from '../context';
import type { Rect } from '../paintFacesPixels';

export type SnapshotTexture = ReturnType<TextureToolContext['getSnapshot']>['textures'][number];
export type SnapshotMesh = NonNullable<
  ReturnType<TextureToolContext['getSnapshot']>['meshes']
>[number];
export type SnapshotMeshFace = SnapshotMesh['faces'][number];

export interface NormalizedMeshTarget {
  readonly meshId?: string;
  readonly meshName?: string;
  readonly faceId?: string;
  readonly scope: 'single_face' | 'all_faces';
}

export interface NormalizedPaintMeshInput {
  readonly target: NormalizedMeshTarget;
  readonly coordSpace: 'face' | 'texture';
  readonly mapping: 'stretch' | 'tile';
  readonly op: TextureOpLike;
}

export interface MeshFaceRect {
  readonly faceId: string;
  readonly rect: Rect;
}

export interface ResolvedMeshFaces {
  readonly rects: readonly MeshFaceRect[];
  readonly skippedFaces: readonly { readonly faceId: string; readonly reason: string }[];
}

export interface TextureReadSource {
  readonly textureWidth: number;
  readonly textureHeight: number;
  readonly pixels: Uint8ClampedArray;
}

export interface SourceSize {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
}

export interface RasterizedMeshFacePaint {
  readonly pixels: Uint8ClampedArray;
  readonly changedPixels: number;
}

export interface PixelStats {
  readonly opaquePixels: number;
  readonly checksum: number;
}
