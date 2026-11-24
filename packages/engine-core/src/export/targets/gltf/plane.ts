import type {
  PlaneFaceDirection,
  PlaneNode,
  ProjectDocument,
  TextureAsset,
  Vec3,
} from '../../../model';
import { canonicalPlaneTextureUvCorners } from '../../minecraft/plane';
import type { GltfPrimitiveData } from './data';
import { multiplyVec3 } from './spatial';
import type { GltfSceneCompileOptions } from './graph';

const faceUvs = (
  plane: PlaneNode,
  texture: TextureAsset | undefined,
  uv: readonly [number, number, number, number] | undefined,
  direction: PlaneFaceDirection,
): readonly number[] | undefined => {
  if (!texture || !uv) return undefined;
  const corners = canonicalPlaneTextureUvCorners(plane, plane.faces[direction], direction);
  if (corners === undefined) return undefined;
  return corners.flatMap(([u, v]) => [u / texture.width, v / texture.height]);
};

const planePoint = (plane: PlaneNode, u: number, v: number): Vec3 => {
  const pivot = plane.transform.pivot;
  if (plane.basis === undefined) {
    return [u - pivot[0], v - pivot[1], -pivot[2]];
  }
  return [
    plane.basis.uAxis[0]! * (u - pivot[0]) +
      plane.basis.vAxis[0]! * (v - pivot[1]) -
      plane.basis.normal[0]! * pivot[2],
    plane.basis.uAxis[1]! * (u - pivot[0]) +
      plane.basis.vAxis[1]! * (v - pivot[1]) -
      plane.basis.normal[1]! * pivot[2],
    plane.basis.uAxis[2]! * (u - pivot[0]) +
      plane.basis.vAxis[2]! * (v - pivot[1]) -
      plane.basis.normal[2]! * pivot[2],
  ];
};

const planeNormal = (plane: PlaneNode, direction: PlaneFaceDirection): Vec3 => {
  const frontNormal: Vec3 = plane.basis?.normal ?? [0, 0, 1];
  if (direction === 'front') return frontNormal;
  return [-frontNormal[0], -frontNormal[1], -frontNormal[2]];
};

const planeMaterial = (
  textureId: string | null,
  options: GltfSceneCompileOptions,
): number | undefined => {
  if (textureId === null) return undefined;
  return (
    options.singleSidedMaterialByTextureId.get(textureId) ??
    options.materialByTextureId.get(textureId)
  );
};

const compilePlaneFace = (
  document: ProjectDocument,
  plane: PlaneNode,
  frontCorners: readonly Vec3[],
  direction: PlaneFaceDirection,
  options: GltfSceneCompileOptions,
): GltfPrimitiveData | null => {
  const face = plane.faces[direction];
  if (!face.enabled) return null;
  const corners =
    direction === 'front'
      ? frontCorners
      : [frontCorners[1]!, frontCorners[0]!, frontCorners[3]!, frontCorners[2]!];
  const normal = planeNormal(plane, direction);
  const texture = face.textureId === null ? undefined : document.textures[face.textureId];
  const uvs = faceUvs(plane, texture, face.uv, direction);
  const material = planeMaterial(face.textureId, options);
  return {
    positions: corners.flatMap((corner) => multiplyVec3(corner, options.unitScale)),
    normals: [normal, normal, normal, normal].flatMap((value) => value),
    ...(uvs ? { uvs } : {}),
    ...(material === undefined ? {} : { material }),
    indices: [0, 1, 2, 0, 2, 3],
  };
};

export const compileGltfPlanePrimitiveData = (
  document: ProjectDocument,
  plane: PlaneNode,
  options: GltfSceneCompileOptions,
): GltfPrimitiveData[] => {
  const frontCorners: readonly Vec3[] = [
    planePoint(plane, 0, 0),
    planePoint(plane, plane.size[0], 0),
    planePoint(plane, plane.size[0], plane.size[1]),
    planePoint(plane, 0, plane.size[1]),
  ];
  const directions: readonly PlaneFaceDirection[] =
    plane.sidedness === 'double' ? ['front', 'back'] : ['front'];
  return directions.flatMap((direction) => {
    const data = compilePlaneFace(document, plane, frontCorners, direction, options);
    return data === null ? [] : [data];
  });
};
