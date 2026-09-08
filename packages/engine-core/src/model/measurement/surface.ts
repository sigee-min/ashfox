import type { ProjectDocument } from '../document';
import { CUBE_FACE_DIRECTIONS, PLANE_FACE_DIRECTIONS } from '../scene';
import type { SurfaceInspection } from './contract';

/** Canonical face addresses only; no compiler/source chart or pixel dump. */
export const inspectNodeSurface = (
  document: ProjectDocument, nodeId: string
): SurfaceInspection | null => {
  const node = Object.prototype.hasOwnProperty.call(document.scene.nodes, nodeId) ? document.scene.nodes[nodeId] : undefined;
  if (!node || (node.kind !== 'cube' && node.kind !== 'plane')) return null;
  const faces = node.kind === 'cube'
    ? CUBE_FACE_DIRECTIONS.map((direction) => ({ direction, face: node.faces[direction] }))
    : PLANE_FACE_DIRECTIONS.map((direction) => ({ direction, face: node.faces[direction] }));
  return {
    schemaVersion: 1 as const, nodeId, kind: node.kind,
    faces: faces.map(({ direction, face }) => {
      const texture = face.textureId === null ? undefined : document.textures[face.textureId];
      return { direction, enabled: face.enabled, textureId: face.textureId,
        uv: face.uv ? [...face.uv] : null, rotation: face.rotation ?? 0,
        pixelSpan: face.uv ? [Math.abs(face.uv[2] - face.uv[0]),
          Math.abs(face.uv[3] - face.uv[1])] : null,
        texture: texture ? { width: texture.width, height: texture.height,
          sampling: texture.sampling, contentHash: texture.source.contentHash } : null };
    })
  };
};
