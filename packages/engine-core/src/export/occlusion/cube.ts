import {
  CUBE_FACE_DIRECTIONS,
  type CubeFace,
  type CubeFaceDirection,
  type CubeNode,
  type ProjectDocument,
  type TextureAsset,
} from '../../model';
import { effectivelyVisibleSceneNodeIds } from '../../sceneVisibility';
import { rasterizeTexture, type CanonicalTextureRaster } from '../../textures/textureRecipe/raster';

type Axis = 0 | 1 | 2;

interface CubeBounds {
  cube: CubeNode;
  min: [number, number, number];
  max: [number, number, number];
}

interface FaceAxes {
  normal: Axis;
  first: Axis;
  second: Axis;
  positive: boolean;
}

const EPSILON = 0.000001;

const FACE_AXES: Record<CubeFaceDirection, FaceAxes> = {
  north: { normal: 2, first: 0, second: 1, positive: false },
  south: { normal: 2, first: 0, second: 1, positive: true },
  east: { normal: 0, first: 2, second: 1, positive: true },
  west: { normal: 0, first: 2, second: 1, positive: false },
  up: { normal: 1, first: 0, second: 2, positive: true },
  down: { normal: 1, first: 0, second: 2, positive: false },
};

const textureRasterForOpacity = (
  document: ProjectDocument,
  texture: TextureAsset | undefined,
  cache: Map<string, CanonicalTextureRaster | null>,
): CanonicalTextureRaster | null => {
  if (texture === undefined) return null;
  const cached = cache.get(texture.id);
  if (cached !== undefined) return cached;
  let raster: CanonicalTextureRaster | null = null;
  if (
    texture.renderMode === 'default' &&
    texture.sampling === 'nearest' &&
    texture.raster !== undefined
  ) {
    try {
      raster = rasterizeTexture(document, texture);
    } catch {
      raster = null;
    }
  }
  cache.set(texture.id, raster);
  return raster;
};

export const canonicalRasterFaceIsOpaque = (
  raster: CanonicalTextureRaster,
  face: CubeFace,
): boolean => {
  if (
    !face.enabled ||
    face.textureId === null ||
    face.uv === undefined ||
    face.uv.some((value) => !Number.isFinite(value) || !Number.isInteger(value))
  )
    return false;
  const minimumU = Math.min(face.uv[0], face.uv[2]);
  const maximumU = Math.max(face.uv[0], face.uv[2]);
  const minimumV = Math.min(face.uv[1], face.uv[3]);
  const maximumV = Math.max(face.uv[1], face.uv[3]);
  if (
    minimumU < 0 ||
    minimumV < 0 ||
    maximumU > raster.width ||
    maximumV > raster.height ||
    minimumU === maximumU ||
    minimumV === maximumV
  )
    return false;
  for (let v = minimumV; v < maximumV; v += 1) {
    for (let u = minimumU; u < maximumU; u += 1) {
      if (raster.rgba.at((v * raster.width + u) * 4 + 3) !== 255) {
        return false;
      }
    }
  }
  return true;
};

const faceHasOpaqueFootprint = (
  document: ProjectDocument,
  face: CubeFace,
  cache: Map<string, CanonicalTextureRaster | null>,
): boolean => {
  if (face.textureId === null) return false;
  const raster = textureRasterForOpacity(document, document.textures[face.textureId], cache);
  return raster !== null && canonicalRasterFaceIsOpaque(raster, face);
};

const cubeIsClosedAndOpaque = (
  document: ProjectDocument,
  cube: CubeNode,
  cache: Map<string, CanonicalTextureRaster | null>,
): boolean =>
  CUBE_FACE_DIRECTIONS.every((direction) => {
    const face = cube.faces[direction];
    return (
      face.enabled &&
      face.textureId !== null &&
      face.materialInstance === undefined &&
      faceHasOpaqueFootprint(document, face, cache)
    );
  });

const axisAlignedBounds = (cube: CubeNode): CubeBounds | null => {
  if (
    cube.geometryMode !== 'axis-box' ||
    cube.inflate !== 0 ||
    cube.transform.rotation.some((value) => Math.abs(value) > EPSILON) ||
    cube.transform.scale.some((value) => Math.abs(value - 1) > EPSILON)
  ) {
    return null;
  }
  const points = [cube.bounds.from, cube.bounds.to].map(
    (point) =>
      point.map((value, axis) => value + cube.transform.position[axis]) as [number, number, number],
  );
  const min = points[0].map((value, axis) => Math.min(value, points[1][axis])) as [
    number,
    number,
    number,
  ];
  const max = points[0].map((value, axis) => Math.max(value, points[1][axis])) as [
    number,
    number,
    number,
  ];
  return min.every((value, axis) => Number.isFinite(value) && max[axis] - value > EPSILON)
    ? { cube, min, max }
    : null;
};

const overlapsInterval = (
  min: number,
  max: number,
  targetMin: number,
  targetMax: number,
): boolean => min < targetMax - EPSILON && max > targetMin + EPSILON;

const coversOutwardSide = (bounds: CubeBounds, plane: number, axes: FaceAxes): boolean =>
  axes.positive
    ? bounds.min[axes.normal] <= plane + EPSILON && bounds.max[axes.normal] > plane + EPSILON
    : bounds.max[axes.normal] >= plane - EPSILON && bounds.min[axes.normal] < plane - EPSILON;

const uniqueSorted = (values: readonly number[]): number[] =>
  [...new Set(values)].sort((left, right) => left - right);

const pointCovered = (
  first: number,
  second: number,
  covers: readonly CubeBounds[],
  axes: FaceAxes,
): boolean =>
  covers.some(
    (bounds) =>
      first >= bounds.min[axes.first] - EPSILON &&
      first <= bounds.max[axes.first] + EPSILON &&
      second >= bounds.min[axes.second] - EPSILON &&
      second <= bounds.max[axes.second] + EPSILON,
  );

const faceIsCovered = (
  target: CubeBounds,
  direction: CubeFaceDirection,
  siblings: readonly CubeBounds[],
): boolean => {
  const axes = FACE_AXES[direction];
  const plane = target[axes.positive ? 'max' : 'min'][axes.normal];
  const firstMin = target.min[axes.first];
  const firstMax = target.max[axes.first];
  const secondMin = target.min[axes.second];
  const secondMax = target.max[axes.second];
  const covers = siblings.filter(
    (candidate) =>
      candidate.cube.id !== target.cube.id &&
      coversOutwardSide(candidate, plane, axes) &&
      overlapsInterval(candidate.min[axes.first], candidate.max[axes.first], firstMin, firstMax) &&
      overlapsInterval(
        candidate.min[axes.second],
        candidate.max[axes.second],
        secondMin,
        secondMax,
      ),
  );
  if (covers.length === 0) return false;
  const firstCoordinates = uniqueSorted([
    firstMin,
    firstMax,
    ...covers.flatMap((bounds) => [
      Math.max(firstMin, bounds.min[axes.first]),
      Math.min(firstMax, bounds.max[axes.first]),
    ]),
  ]);
  const secondCoordinates = uniqueSorted([
    secondMin,
    secondMax,
    ...covers.flatMap((bounds) => [
      Math.max(secondMin, bounds.min[axes.second]),
      Math.min(secondMax, bounds.max[axes.second]),
    ]),
  ]);
  for (let first = 0; first < firstCoordinates.length - 1; first += 1) {
    for (let second = 0; second < secondCoordinates.length - 1; second += 1) {
      const firstMiddle = (firstCoordinates[first] + firstCoordinates[first + 1]) / 2;
      const secondMiddle = (secondCoordinates[second] + secondCoordinates[second + 1]) / 2;
      if (!pointCovered(firstMiddle, secondMiddle, covers, axes)) return false;
    }
  }
  return true;
};

export type CubeFaceOcclusion = ReadonlyMap<string, ReadonlySet<CubeFaceDirection>>;

export const compileOpaqueCubeFaceOcclusion = (
  document: ProjectDocument,
  options: { groupLooseCubes?: boolean } = {},
): CubeFaceOcclusion => {
  const visible = effectivelyVisibleSceneNodeIds(document);
  const animated = new Set(
    Object.values(document.animations).flatMap((clip) =>
      Object.values(clip.channels).map((channel) => channel.targetNodeId),
    ),
  );
  const groups = new Map<string, CubeBounds[]>();
  const rasterCache = new Map<string, CanonicalTextureRaster | null>();
  for (const node of Object.values(document.scene.nodes)) {
    if (
      node.kind !== 'cube' ||
      !visible.has(node.id) ||
      animated.has(node.id) ||
      !cubeIsClosedAndOpaque(document, node, rasterCache)
    ) {
      continue;
    }
    const bounds = axisAlignedBounds(node);
    if (!bounds) continue;
    const groupKey =
      node.parentId === null
        ? options.groupLooseCubes
          ? 'loose:shared'
          : `loose:${node.id}`
        : `parent:${node.parentId}`;
    const siblings = groups.get(groupKey) ?? [];
    siblings.push(bounds);
    groups.set(groupKey, siblings);
  }
  const result = new Map<string, ReadonlySet<CubeFaceDirection>>();
  for (const siblings of groups.values()) {
    if (siblings.length < 2) continue;
    for (const target of siblings) {
      const occluded = new Set(
        CUBE_FACE_DIRECTIONS.filter((direction) => faceIsCovered(target, direction, siblings)),
      );
      if (occluded.size > 0) result.set(target.cube.id, occluded);
    }
  }
  return result;
};
