import type {
  PlaneFaceDirection,
  PlaneNode,
  ProjectDocument,
  TextureAsset,
  Vec3
} from '../../../model';
import { canonicalPlaneTextureUvCorners } from '../../minecraft/plane';
import type { GltfPrimitiveData } from './data';
import { multiplyVec3 } from './spatial';
import type { GltfSceneCompileOptions } from './graph';

const faceUvs = (
  plane: PlaneNode,
  texture: TextureAsset | undefined,
  uv: readonly [number, number, number, number] | undefined,
  direction: PlaneFaceDirection
): readonly number[] | undefined => {
  if (!texture || !uv) return undefined;
  const corners = canonicalPlaneTextureUvCorners(
    plane, plane.faces[direction], direction
  );
  if (corners === undefined) return undefined;
  return corners.flatMap(([u, v]) => [
    u / texture.width,
    v / texture.height
  ]);
};

export const compileGltfPlanePrimitiveData = (
  document: ProjectDocument,
  plane: PlaneNode,
  options: GltfSceneCompileOptions
): GltfPrimitiveData[] => {
  const pivot = plane.transform.pivot;
  const point = (u: number, v: number): Vec3 => plane.basis === undefined
    ? [u - pivot[0], v - pivot[1], -pivot[2]]
    : [
        plane.basis.uAxis[0]! * (u - pivot[0]) +
          plane.basis.vAxis[0]! * (v - pivot[1]) -
          plane.basis.normal[0]! * pivot[2],
        plane.basis.uAxis[1]! * (u - pivot[0]) +
          plane.basis.vAxis[1]! * (v - pivot[1]) -
          plane.basis.normal[1]! * pivot[2],
        plane.basis.uAxis[2]! * (u - pivot[0]) +
          plane.basis.vAxis[2]! * (v - pivot[1]) -
          plane.basis.normal[2]! * pivot[2]
      ];
  const frontCorners: readonly Vec3[] = [
    point(0, 0),
    point(plane.size[0], 0),
    point(plane.size[0], plane.size[1]),
    point(0, plane.size[1])
  ];
  const directions = plane.sidedness === 'double'
    ? ['front', 'back'] as const
    : ['front'] as const;
  return directions.flatMap((direction) => {
    const face = plane.faces[direction];
    if (!face.enabled) return [];
    const corners = direction === 'front'
      ? frontCorners
      : [frontCorners[1]!, frontCorners[0]!, frontCorners[3]!, frontCorners[2]!];
    const normal: Vec3 = direction === 'front'
      ? (plane.basis?.normal ?? [0, 0, 1])
      : plane.basis === undefined
        ? [0, 0, -1]
        : [
          -plane.basis.normal[0],
          -plane.basis.normal[1],
          -plane.basis.normal[2]
        ] as Vec3;
    const texture = face.textureId === null
      ? undefined : document.textures[face.textureId];
    const uvs = faceUvs(plane, texture, face.uv, direction);
    const material = face.textureId === null ? undefined :
      options.singleSidedMaterialByTextureId.get(face.textureId) ??
      options.materialByTextureId.get(face.textureId);
    return [{
      positions: corners.flatMap((corner) =>
        multiplyVec3(corner, options.unitScale)
      ),
      normals: [normal, normal, normal, normal].flatMap((value) => value),
      ...(uvs ? { uvs } : {}),
      ...(material === undefined ? {} : { material }),
      indices: [0, 1, 2, 0, 2, 3]
    }];
  });
};
