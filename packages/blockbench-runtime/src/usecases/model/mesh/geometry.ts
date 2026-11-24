import type { ToolError } from '@ashfox/blockbench-contracts/types/internal';
import {
  MODEL_MESH_FACE_DEGENERATE,
  MODEL_MESH_FACE_UV_VERTEX_UNKNOWN,
  MODEL_MESH_FACE_VERTEX_UNKNOWN,
  MODEL_MESH_FACE_VERTICES_REQUIRED,
  MODEL_MESH_FACES_REQUIRED,
  MODEL_MESH_VERTEX_ID_DUPLICATE,
  MODEL_MESH_VERTEX_ID_REQUIRED,
  MODEL_MESH_VERTEX_POS_INVALID,
  MODEL_MESH_VERTICES_REQUIRED,
} from '../../../shared/messages';
import type { MeshFaceInput, MeshVertexInput } from './contract';

const resolveFaceId = (faceId: string | undefined, index: number): string => {
  const normalized = String(faceId ?? '').trim();
  return normalized.length > 0 ? normalized : `face_${index}`;
};

const polygonArea = (vertices: [number, number, number][]): number => {
  const origin = vertices[0];
  let area = 0;
  for (let index = 1; index < vertices.length - 1; index += 1) {
    const ax = vertices[index][0] - origin[0];
    const ay = vertices[index][1] - origin[1];
    const az = vertices[index][2] - origin[2];
    const bx = vertices[index + 1][0] - origin[0];
    const by = vertices[index + 1][1] - origin[1];
    const bz = vertices[index + 1][2] - origin[2];
    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;
    area += Math.sqrt(cx * cx + cy * cy + cz * cz) * 0.5;
  }
  return area;
};

export const validateMeshGeometry = (
  vertices: MeshVertexInput[] | undefined,
  faces: MeshFaceInput[] | undefined,
): ToolError | null => {
  if (!vertices || vertices.length < 3) {
    return { code: 'invalid_payload', message: MODEL_MESH_VERTICES_REQUIRED };
  }
  if (!faces || faces.length < 1) {
    return { code: 'invalid_payload', message: MODEL_MESH_FACES_REQUIRED };
  }

  const vertexIds = new Set<string>();
  const vertexMap = new Map<string, [number, number, number]>();
  for (const vertex of vertices) {
    const id = String(vertex.id ?? '').trim();
    if (!id) {
      return { code: 'invalid_payload', message: MODEL_MESH_VERTEX_ID_REQUIRED };
    }
    if (
      !Number.isFinite(vertex.pos[0]) ||
      !Number.isFinite(vertex.pos[1]) ||
      !Number.isFinite(vertex.pos[2])
    ) {
      return { code: 'invalid_payload', message: MODEL_MESH_VERTEX_POS_INVALID(id) };
    }
    if (vertexIds.has(id)) {
      return { code: 'invalid_payload', message: MODEL_MESH_VERTEX_ID_DUPLICATE(id) };
    }
    vertexIds.add(id);
    vertexMap.set(id, vertex.pos);
  }

  for (let faceIndex = 0; faceIndex < faces.length; faceIndex += 1) {
    const face = faces[faceIndex];
    const faceId = resolveFaceId(face.id, faceIndex);
    if (!Array.isArray(face.vertices) || face.vertices.length < 3) {
      return { code: 'invalid_payload', message: MODEL_MESH_FACE_VERTICES_REQUIRED };
    }
    if (new Set(face.vertices).size < 3) {
      return { code: 'invalid_payload', message: MODEL_MESH_FACE_VERTICES_REQUIRED };
    }
    const polygon: [number, number, number][] = [];
    for (const vertexId of face.vertices) {
      const point = vertexMap.get(vertexId);
      if (!point) {
        return { code: 'invalid_payload', message: MODEL_MESH_FACE_VERTEX_UNKNOWN(vertexId) };
      }
      polygon.push(point);
    }
    if (polygonArea(polygon) <= 1e-6) {
      return { code: 'invalid_payload', message: MODEL_MESH_FACE_DEGENERATE(faceId) };
    }
    for (const point of face.uv ?? []) {
      if (!vertexIds.has(point.vertexId)) {
        return {
          code: 'invalid_payload',
          message: MODEL_MESH_FACE_UV_VERTEX_UNKNOWN(point.vertexId),
        };
      }
    }
  }
  return null;
};

export const hasFaceUvInput = (faces: MeshFaceInput[] | undefined): boolean =>
  Array.isArray(faces) && faces.some((face) => Array.isArray(face.uv) && face.uv.length > 0);

export const stripUvFromFaces = (faces: MeshFaceInput[] | undefined): MeshFaceInput[] | undefined =>
  faces?.map((face) => ({
    ...(face.id ? { id: face.id } : {}),
    vertices: [...face.vertices],
    ...(Object.prototype.hasOwnProperty.call(face, 'texture') ? { texture: face.texture } : {}),
  }));

export const hasCompleteFaceUv = (faces: MeshFaceInput[] | undefined): boolean => {
  if (!Array.isArray(faces) || faces.length === 0) return false;
  for (const face of faces) {
    if (!Array.isArray(face.vertices) || face.vertices.length < 3) return false;
    if (!Array.isArray(face.uv) || face.uv.length < face.vertices.length) {
      return false;
    }
    const uvVertexIds = new Set(face.uv.map((entry) => entry.vertexId));
    for (const vertexId of face.vertices) {
      if (!uvVertexIds.has(vertexId)) return false;
    }
  }
  return true;
};
