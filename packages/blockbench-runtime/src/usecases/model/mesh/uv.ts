import type { EditorPort } from '../../../ports/editor';
import type { SessionState } from '../../../session';
import { autoMapMeshUv, type MeshUvPolicy } from '../../../domain/mesh/autoUv';
import type { AutoMappedMesh, MeshFaceInput, MeshVertexInput } from './contract';

const normalizeDimension = (value: unknown): number | null => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.max(1, Math.trunc(numeric));
};

const meshUvResolution = (
  editorResolution: { width: number; height: number } | null,
  snapshot: SessionState,
): { width: number; height: number } => {
  const snapshotTexture = snapshot.textures.find((texture) => texture.width && texture.height);
  return {
    width:
      normalizeDimension(editorResolution?.width) ??
      normalizeDimension(snapshotTexture?.width) ??
      64,
    height:
      normalizeDimension(editorResolution?.height) ??
      normalizeDimension(snapshotTexture?.height) ??
      64,
  };
};

export const autoMapMesh = (
  editor: EditorPort,
  snapshot: SessionState,
  vertices: MeshVertexInput[],
  faces: MeshFaceInput[],
  policy?: MeshUvPolicy,
): AutoMappedMesh => {
  const resolution = meshUvResolution(editor.getProjectTextureResolution(), snapshot);
  return autoMapMeshUv({
    vertices,
    faces,
    textureWidth: resolution.width,
    textureHeight: resolution.height,
    policy,
  });
};
