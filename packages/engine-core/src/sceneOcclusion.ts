import { CUBE_FACE_DIRECTIONS, type CubeNode, type ProjectDocument } from './model';
import { effectivelyVisibleSceneNodeIds } from './sceneVisibility';
import { compareText } from './stableOrder';

export interface FullyOccludedCube {
  innerId: string;
  outerId: string;
}

interface OcclusionEntry {
  readonly id: string;
  readonly parentId: string | null;
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
  readonly volume: number;
  readonly opaque: boolean;
}

const EPSILON = 0.000001;

const hasIdentityRotationAndScale = (cube: CubeNode): boolean =>
  Math.abs(cube.transform.rotation[0]) <= EPSILON &&
  Math.abs(cube.transform.rotation[1]) <= EPSILON &&
  Math.abs(cube.transform.rotation[2]) <= EPSILON &&
  Math.abs(cube.transform.scale[0] - 1) <= EPSILON &&
  Math.abs(cube.transform.scale[1] - 1) <= EPSILON &&
  Math.abs(cube.transform.scale[2] - 1) <= EPSILON;

const isTextureOpaque = (
  document: ProjectDocument,
  textureId: string,
  cache: Map<string, boolean>,
): boolean => {
  const cached = cache.get(textureId);
  if (cached !== undefined) return cached;
  const texture = document.textures[textureId];
  const opaque =
    texture?.renderMode === 'default' &&
    texture.raster !== undefined &&
    texture.raster.backgroundAlpha === 255 &&
    texture.raster.canvasDetails.every((detail) => detail.alpha === 255);
  cache.set(textureId, opaque);
  return opaque;
};

const isOpaqueTexturedCube = (
  document: ProjectDocument,
  cube: CubeNode,
  textureCache: Map<string, boolean>,
): boolean => {
  for (const direction of CUBE_FACE_DIRECTIONS) {
    const face = cube.faces[direction];
    if (!face.enabled || face.textureId === null) return false;
    if (!isTextureOpaque(document, face.textureId, textureCache)) return false;
  }
  return true;
};

const toOcclusionEntry = (
  document: ProjectDocument,
  cube: CubeNode,
  textureCache: Map<string, boolean>,
): OcclusionEntry | null => {
  if (cube.geometryMode !== 'axis-box') return null;
  const px = cube.transform.position[0];
  const py = cube.transform.position[1];
  const pz = cube.transform.position[2];
  const inf = cube.inflate;
  const minX = cube.bounds.from[0] + px - inf;
  const minY = cube.bounds.from[1] + py - inf;
  const minZ = cube.bounds.from[2] + pz - inf;
  const maxX = cube.bounds.to[0] + px + inf;
  const maxY = cube.bounds.to[1] + py + inf;
  const maxZ = cube.bounds.to[2] + pz + inf;
  const dx = maxX - minX;
  const dy = maxY - minY;
  const dz = maxZ - minZ;
  if (dx <= EPSILON || dy <= EPSILON || dz <= EPSILON) return null;
  return {
    id: cube.id,
    parentId: cube.parentId,
    minX,
    minY,
    minZ,
    maxX,
    maxY,
    maxZ,
    volume: dx * dy * dz,
    opaque: isOpaqueTexturedCube(document, cube, textureCache),
  };
};

const contains = (outer: OcclusionEntry, inner: OcclusionEntry): boolean =>
  outer.minX <= inner.minX + EPSILON &&
  outer.minY <= inner.minY + EPSILON &&
  outer.minZ <= inner.minZ + EPSILON &&
  outer.maxX >= inner.maxX - EPSILON &&
  outer.maxY >= inner.maxY - EPSILON &&
  outer.maxZ >= inner.maxZ - EPSILON;

const bestEnclosingOuter = (
  inner: OcclusionEntry,
  siblings: readonly OcclusionEntry[],
): string | null => {
  let bestId: string | null = null;
  let bestVolume = Infinity;
  for (let index = 0; index < siblings.length; index += 1) {
    const outer = siblings[index]!;
    if (!outer.opaque || outer.id === inner.id) continue;
    if (
      outer.volume < inner.volume - EPSILON ||
      (Math.abs(outer.volume - inner.volume) <= EPSILON && outer.id >= inner.id)
    ) {
      continue;
    }
    if (!contains(outer, inner)) continue;
    if (
      outer.volume < bestVolume ||
      (outer.volume === bestVolume && (bestId === null || compareText(outer.id, bestId) < 0))
    ) {
      bestVolume = outer.volume;
      bestId = outer.id;
    }
  }
  return bestId;
};

const collectAnimatedNodeIds = (document: ProjectDocument): Set<string> => {
  const ids = new Set<string>();
  for (const clip of Object.values(document.animations)) {
    for (const channel of Object.values(clip.channels)) {
      ids.add(channel.targetNodeId);
    }
  }
  return ids;
};

export const findFullyOccludedCubes = (document: ProjectDocument): readonly FullyOccludedCube[] => {
  const visibleNodeIds = effectivelyVisibleSceneNodeIds(document);
  const animatedNodeIds = collectAnimatedNodeIds(document);
  const textureCache = new Map<string, boolean>();
  const entries: OcclusionEntry[] = [];
  const byParent = new Map<string | null, OcclusionEntry[]>();

  for (const node of Object.values(document.scene.nodes)) {
    if (
      node.kind !== 'cube' ||
      !visibleNodeIds.has(node.id) ||
      animatedNodeIds.has(node.id) ||
      !hasIdentityRotationAndScale(node)
    ) {
      continue;
    }
    const entry = toOcclusionEntry(document, node, textureCache);
    if (entry === null) continue;
    entries.push(entry);
    const siblings = byParent.get(entry.parentId);
    if (siblings) siblings.push(entry);
    else byParent.set(entry.parentId, [entry]);
  }
  entries.sort((left, right) => compareText(left.id, right.id));
  const result: FullyOccludedCube[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const inner = entries[index]!;
    const outerId = bestEnclosingOuter(inner, byParent.get(inner.parentId)!);
    if (outerId !== null) result.push({ innerId: inner.id, outerId });
  }
  return result;
};
