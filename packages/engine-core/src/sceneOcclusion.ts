import { CUBE_FACE_DIRECTIONS, type CubeNode, type ProjectDocument, type Vec3 } from './model';
import { effectivelyVisibleSceneNodeIds } from './sceneVisibility';

export interface FullyOccludedCube {
  innerId: string;
  outerId: string;
}

interface CubeBounds {
  minimum: Vec3;
  maximum: Vec3;
}

const EPSILON = 0.000001;

const hasIdentityRotationAndScale = (cube: CubeNode): boolean =>
  cube.transform.rotation.every((value) => Math.abs(value) <= EPSILON) &&
  cube.transform.scale.every((value) => Math.abs(value - 1) <= EPSILON);

const isOpaqueTexturedCube = (document: ProjectDocument, cube: CubeNode): boolean =>
  CUBE_FACE_DIRECTIONS.every((direction) => {
    const face = cube.faces[direction];
    const texture = face.textureId === null ? undefined : document.textures[face.textureId];
    return (
      face.enabled &&
      texture?.renderMode === 'default' &&
      texture.raster !== undefined &&
      texture.raster.backgroundAlpha === 255 &&
      texture.raster.canvasDetails.every((detail) => detail.alpha === 255)
    );
  });

const renderedBounds = (cube: CubeNode): CubeBounds | null => {
  if (cube.geometryMode !== 'axis-box') return null;
  const minimum = cube.bounds.from.map(
    (value, index) => value + cube.transform.position[index] - cube.inflate,
  ) as [number, number, number];
  const maximum = cube.bounds.to.map(
    (value, index) => value + cube.transform.position[index] + cube.inflate,
  ) as [number, number, number];
  return minimum.every((value, index) => maximum[index] - value > EPSILON)
    ? { minimum, maximum }
    : null;
};

const contains = (outer: CubeBounds, inner: CubeBounds): boolean =>
  outer.minimum.every((value, index) => value <= inner.minimum[index] + EPSILON) &&
  outer.maximum.every((value, index) => value >= inner.maximum[index] - EPSILON);

const volume = (bounds: CubeBounds): number =>
  bounds.maximum.reduce((result, value, index) => result * (value - bounds.minimum[index]), 1);

export const findFullyOccludedCubes = (document: ProjectDocument): readonly FullyOccludedCube[] => {
  const visibleNodeIds = effectivelyVisibleSceneNodeIds(document);
  const animatedNodeIds = new Set(
    Object.values(document.animations).flatMap((clip) =>
      Object.values(clip.channels).map((channel) => channel.targetNodeId),
    ),
  );
  const cubes = Object.values(document.scene.nodes)
    .filter(
      (node): node is CubeNode =>
        node.kind === 'cube' &&
        visibleNodeIds.has(node.id) &&
        !animatedNodeIds.has(node.id) &&
        hasIdentityRotationAndScale(node),
    )
    .map((cube) => ({
      cube,
      bounds: renderedBounds(cube),
    }))
    .filter((entry): entry is { cube: CubeNode; bounds: CubeBounds } => entry.bounds !== null)
    .sort((left, right) => left.cube.id.localeCompare(right.cube.id));

  return cubes.flatMap((inner) => {
    const innerVolume = volume(inner.bounds);
    const outer = cubes
      .filter((candidate) => {
        if (
          candidate.cube.id === inner.cube.id ||
          candidate.cube.parentId !== inner.cube.parentId ||
          !isOpaqueTexturedCube(document, candidate.cube) ||
          !contains(candidate.bounds, inner.bounds)
        ) {
          return false;
        }
        const candidateVolume = volume(candidate.bounds);
        return (
          candidateVolume > innerVolume + EPSILON ||
          (Math.abs(candidateVolume - innerVolume) <= EPSILON && candidate.cube.id < inner.cube.id)
        );
      })
      .sort(
        (left, right) =>
          volume(left.bounds) - volume(right.bounds) || left.cube.id.localeCompare(right.cube.id),
      )[0];
    return outer
      ? [
          {
            innerId: inner.cube.id,
            outerId: outer.cube.id,
          },
        ]
      : [];
  });
};
