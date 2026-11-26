import { compareText } from '@ashfox/internal-contracts';
import { add3, dot3, length3, mul3, normalize3, sub3 } from '../math/vec3';
import type { Vec3 } from '../model/identity';
import {
  CUBE_FACE_DIRECTIONS,
  PLANE_FACE_DIRECTIONS,
  cubeGeometryPivot,
  cubeGeometryRotation,
  cubeUnrotatedBounds,
  type CubeFace,
  type CubeNode,
  type PlaneNode,
  type SceneGraph,
  type SceneNode,
} from '../model/scene';
import { canonicalRotatePoint } from '../model/transform';
import type { TextureAsset } from '../model/texture';

export interface AuditFaceBinding {
  readonly nodeId: string;
  readonly direction: string;
  readonly face: CubeFace;
  readonly worldWidth: number;
  readonly worldHeight: number;
  readonly isTop: boolean;
  readonly isBottom: boolean;
}

export interface AuditObb {
  readonly nodeId: string;
  readonly parentId: string | null;
  readonly center: Vec3;
  readonly half: Vec3;
  readonly ax: Vec3;
  readonly ay: Vec3;
  readonly az: Vec3;
  readonly corners: readonly Vec3[];
  readonly aabbMin: Vec3;
  readonly aabbMax: Vec3;
  readonly volume: number;
  readonly angled: boolean;
  readonly isPlane: boolean;
  readonly solidPlane: boolean;
  readonly opaque: boolean;
}

export interface AuditSceneGeometry {
  readonly visibleNodeIds: ReadonlySet<string>;
  readonly obbs: readonly AuditObb[];
  readonly enabledFaces: readonly AuditFaceBinding[];
  readonly worldMin: Vec3;
  readonly worldMax: Vec3;
  readonly boneCount: number;
  readonly maxBoneDepth: number;
  readonly hasOrphanEmptyBones: boolean;
}

const origin = (node: SceneNode): Vec3 => add3(node.transform.pivot, node.transform.position);

const isVisibleNode = (
  nodes: Readonly<Record<string, SceneNode>>,
  nodeId: string,
  memo: Map<string, boolean>,
  visiting: Set<string>,
): boolean => {
  const cached = memo.get(nodeId);
  if (cached !== undefined) return cached;
  if (visiting.has(nodeId)) return false;
  const node = Object.prototype.hasOwnProperty.call(nodes, nodeId) ? nodes[nodeId] : undefined;
  if (!node || !node.visible) {
    memo.set(nodeId, false);
    return false;
  }
  if (node.parentId === null) {
    memo.set(nodeId, true);
    return true;
  }
  visiting.add(nodeId);
  const visible = isVisibleNode(nodes, node.parentId, memo, visiting);
  visiting.delete(nodeId);
  memo.set(nodeId, visible);
  return visible;
};

export const collectVisibleNodeIds = (scene: SceneGraph): ReadonlySet<string> => {
  const memo = new Map<string, boolean>();
  const visiting = new Set<string>();
  const visible = new Set<string>();
  for (const id of Object.keys(scene.nodes)) {
    if (isVisibleNode(scene.nodes, id, memo, visiting)) visible.add(id);
  }
  return visible;
};

const boneChain = (
  nodes: Readonly<Record<string, SceneNode>>,
  node: SceneNode,
  cache: Map<string, readonly SceneNode[]>,
): readonly SceneNode[] => {
  const cached = cache.get(node.id);
  if (cached !== undefined) return cached;
  const chain: SceneNode[] = [node];
  const seen = new Set<string>([node.id]);
  let parentId = node.parentId;
  while (parentId !== null && chain.length < 128) {
    if (seen.has(parentId)) break;
    const parent = Object.prototype.hasOwnProperty.call(nodes, parentId)
      ? nodes[parentId]
      : undefined;
    if (!parent || parent.kind !== 'bone') break;
    seen.add(parentId);
    chain.push(parent);
    parentId = parent.parentId;
  }
  cache.set(node.id, chain);
  return chain;
};

const toModelSpace = (localPoint: Vec3, chain: readonly SceneNode[]): Vec3 => {
  let point = localPoint;
  for (let i = 0; i < chain.length; i += 1) {
    const owner = chain[i]!;
    const parent = chain[i + 1];
    const translation = sub3(origin(owner), parent ? origin(parent) : [0, 0, 0]);
    point = add3(
      canonicalRotatePoint(mul3(point, owner.transform.scale), owner.transform.rotation),
      translation,
    );
  }
  return point;
};

const cubeLocalPoint = (node: CubeNode, point: Vec3): Vec3 => {
  const pivot = cubeGeometryPivot(node);
  const rel = sub3(point, pivot);
  return node.geometryMode === 'oriented-box'
    ? add3(canonicalRotatePoint(rel, cubeGeometryRotation(node)), pivot)
    : rel;
};

const planeLocalPoint = (node: PlaneNode, u: number, v: number, n: number): Vec3 => {
  const ux = node.basis?.uAxis ?? [1, 0, 0];
  const vx = node.basis?.vAxis ?? [0, 1, 0];
  const nx = node.basis?.normal ?? [0, 0, 1];
  const p = node.transform.pivot;
  return [
    ux[0] * (u - p[0]) + vx[0] * (v - p[1]) + nx[0] * (n - p[2]),
    ux[1] * (u - p[0]) + vx[1] * (v - p[1]) + nx[1] * (n - p[2]),
    ux[2] * (u - p[0]) + vx[2] * (v - p[1]) + nx[2] * (n - p[2]),
  ];
};

const hasAngledRotation = (rot: Vec3): boolean => rot.some((deg) => Math.abs(deg) >= 2.5);

interface TransparentMaskSpan {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

interface TextureOpacityInfo {
  readonly detailsOpaque: boolean;
  readonly transparentMasks: readonly TransparentMaskSpan[];
}

const buildTextureOpacityCache = (
  textures: Readonly<Record<string, TextureAsset>>,
): Map<string, TextureOpacityInfo> => {
  const cache = new Map<string, TextureOpacityInfo>();
  for (const [id, tex] of Object.entries(textures)) {
    if (
      tex.renderMode !== 'default' ||
      tex.raster === undefined ||
      tex.raster.backgroundAlpha !== 255
    ) {
      cache.set(id, { detailsOpaque: false, transparentMasks: [] });
      continue;
    }
    const detailsOpaque = tex.raster.canvasDetails.every((d) => d.alpha === 255);
    if (!detailsOpaque) {
      cache.set(id, { detailsOpaque: false, transparentMasks: [] });
      continue;
    }
    const transparentMasks: TransparentMaskSpan[] = [];
    const masks = tex.raster.alphaMasks ?? [];
    for (let i = 0; i < masks.length; i += 1) {
      const m = masks[i]!;
      if (m.bits.includes('0')) {
        transparentMasks.push({ x0: m.x, y0: m.y, x1: m.x + m.width, y1: m.y + m.height });
      }
    }
    cache.set(id, { detailsOpaque: true, transparentMasks });
  }
  return cache;
};

const faceMaskCoversUv = (face: CubeFace, masks: readonly TransparentMaskSpan[]): boolean => {
  if (masks.length === 0) return false;
  const uv = face.uv;
  if (!uv) return false;
  const x0 = Math.min(uv[0], uv[2]);
  const x1 = Math.max(uv[0], uv[2]);
  const y0 = Math.min(uv[1], uv[3]);
  const y1 = Math.max(uv[1], uv[3]);
  for (let i = 0; i < masks.length; i += 1) {
    const m = masks[i]!;
    if (m.x0 < x1 && m.x1 > x0 && m.y0 < y1 && m.y1 > y0) return true;
  }
  return false;
};

const isOpaqueFace = (
  face: CubeFace,
  opacityCache: ReadonlyMap<string, TextureOpacityInfo>,
): boolean => {
  if (!face.enabled || face.textureId === null) return false;
  const info = opacityCache.get(face.textureId);
  if (info === undefined || !info.detailsOpaque) return false;
  return !faceMaskCoversUv(face, info.transparentMasks);
};

const buildObbFromBasisPoints = (
  nodeId: string,
  parentId: string | null,
  p000: Vec3,
  p100: Vec3,
  p010: Vec3,
  p001: Vec3,
  angled: boolean,
  isPlane: boolean,
  solidPlane: boolean,
  opaque: boolean,
): AuditObb => {
  const vx = sub3(p100, p000);
  const vy = sub3(p010, p000);
  const vz = sub3(p001, p000);
  const half: Vec3 = [length3(vx) * 0.5, length3(vy) * 0.5, length3(vz) * 0.5];
  const center: Vec3 = [
    p000[0] + (vx[0] + vy[0] + vz[0]) * 0.5,
    p000[1] + (vx[1] + vy[1] + vz[1]) * 0.5,
    p000[2] + (vx[2] + vy[2] + vz[2]) * 0.5,
  ];
  const corners: Vec3[] = [];
  const aabbMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const aabbMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const sx of [0, 1]) {
    for (const sy of [0, 1]) {
      for (const sz of [0, 1]) {
        const c: Vec3 = [
          p000[0] + sx * vx[0] + sy * vy[0] + sz * vz[0],
          p000[1] + sx * vx[1] + sy * vy[1] + sz * vz[1],
          p000[2] + sx * vx[2] + sy * vy[2] + sz * vz[2],
        ];
        corners.push(c);
        for (let k = 0; k < 3; k += 1) {
          aabbMin[k] = Math.min(aabbMin[k]!, c[k]!);
          aabbMax[k] = Math.max(aabbMax[k]!, c[k]!);
        }
      }
    }
  }
  return {
    nodeId,
    parentId,
    center,
    half,
    ax: normalize3(vx),
    ay: normalize3(vy),
    az: normalize3(vz),
    corners,
    aabbMin,
    aabbMax,
    volume: Math.max(0, half[0] * half[1] * half[2] * 8),
    angled,
    isPlane,
    solidPlane,
    opaque,
  };
};

const cubeObb = (
  node: CubeNode,
  chain: readonly SceneNode[],
  opacityCache: ReadonlyMap<string, TextureOpacityInfo>,
): AuditObb => {
  const b = cubeUnrotatedBounds(node);
  const f = [b.from[0] - node.inflate, b.from[1] - node.inflate, b.from[2] - node.inflate] as const;
  const t = [b.to[0] + node.inflate, b.to[1] + node.inflate, b.to[2] + node.inflate] as const;
  const mapPt = (pt: Vec3): Vec3 => toModelSpace(cubeLocalPoint(node, pt), chain);
  const angled =
    hasAngledRotation(cubeGeometryRotation(node)) ||
    chain.some((entry) => hasAngledRotation(entry.transform.rotation));
  let opaque = true;
  for (let i = 0; i < CUBE_FACE_DIRECTIONS.length; i += 1) {
    if (!isOpaqueFace(node.faces[CUBE_FACE_DIRECTIONS[i]!], opacityCache)) {
      opaque = false;
      break;
    }
  }
  return buildObbFromBasisPoints(
    node.id,
    node.parentId,
    mapPt([f[0], f[1], f[2]]),
    mapPt([t[0], f[1], f[2]]),
    mapPt([f[0], t[1], f[2]]),
    mapPt([f[0], f[1], t[2]]),
    angled,
    false,
    false,
    opaque,
  );
};

const isCutoutPlane = (
  node: PlaneNode,
  textures: Readonly<Record<string, TextureAsset>>,
): boolean => {
  const face = node.faces.front;
  if (face.textureId === null || face.uv === undefined) return false;
  const masks = textures[face.textureId]?.raster?.alphaMasks;
  if (!masks || masks.length === 0) return false;
  const ux = Math.min(face.uv[0], face.uv[2]);
  const uy = Math.min(face.uv[1], face.uv[3]);
  return masks.some((m) => m.x === ux && m.y === uy && m.bits.includes('0'));
};

const planeObb = (
  node: PlaneNode,
  chain: readonly SceneNode[],
  textures: Readonly<Record<string, TextureAsset>>,
): AuditObb => {
  const mapPt = (u: number, v: number, n: number): Vec3 =>
    toModelSpace(planeLocalPoint(node, u, v, n), chain);
  return buildObbFromBasisPoints(
    node.id,
    node.parentId,
    mapPt(0, 0, -0.05),
    mapPt(node.size[0], 0, -0.05),
    mapPt(0, node.size[1], -0.05),
    mapPt(0, 0, 0.05),
    true,
    true,
    !isCutoutPlane(node, textures),
    false,
  );
};

const cubeFaceWorldSize = (
  node: CubeNode,
  dir: (typeof CUBE_FACE_DIRECTIONS)[number],
): [number, number] => {
  const b = cubeUnrotatedBounds(node);
  const dx = Math.abs(b.to[0] - b.from[0]) + node.inflate * 2;
  const dy = Math.abs(b.to[1] - b.from[1]) + node.inflate * 2;
  const dz = Math.abs(b.to[2] - b.from[2]) + node.inflate * 2;
  if (dir === 'north' || dir === 'south') return [dx, dy];
  if (dir === 'east' || dir === 'west') return [dz, dy];
  return [dx, dz];
};

const collectNodeFaces = (
  node: CubeNode | PlaneNode,
  obb: AuditObb,
  worldCenterY: number,
  out: AuditFaceBinding[],
): void => {
  if (node.kind === 'cube') {
    for (const dir of CUBE_FACE_DIRECTIONS) {
      const face = node.faces[dir];
      if (!face.enabled) continue;
      const [worldWidth, worldHeight] = cubeFaceWorldSize(node, dir);
      out.push({
        nodeId: node.id,
        direction: dir,
        face,
        worldWidth,
        worldHeight,
        isTop: dir === 'up' || (dir !== 'down' && obb.center[1] > worldCenterY),
        isBottom: dir === 'down' || (dir !== 'up' && obb.center[1] < worldCenterY),
      });
    }
    return;
  }
  for (const dir of PLANE_FACE_DIRECTIONS) {
    const face = node.faces[dir];
    if (!face.enabled) continue;
    const ny = Math.abs(dot3(obb.az, [0, 1, 0]));
    out.push({
      nodeId: node.id,
      direction: dir,
      face,
      worldWidth: node.size[0],
      worldHeight: node.size[1],
      isTop: ny > 0.5 || obb.center[1] > worldCenterY,
      isBottom: obb.center[1] < worldCenterY,
    });
  }
};

const boneStats = (
  nodes: readonly SceneNode[],
  visible: ReadonlySet<string>,
  sceneNodes: Readonly<Record<string, SceneNode>>,
  chainCache: Map<string, readonly SceneNode[]>,
): {
  readonly boneCount: number;
  readonly maxBoneDepth: number;
  readonly hasOrphanEmptyBones: boolean;
} => {
  const bones = nodes.filter((n) => n.kind === 'bone' && visible.has(n.id));
  const usedAsParent = new Set(nodes.map((n) => n.parentId).filter((p): p is string => p !== null));
  let maxDepth = 0;
  for (const bone of bones) {
    const chain = boneChain(sceneNodes, bone, chainCache);
    if (chain.length > maxDepth) maxDepth = chain.length;
  }
  const hasOrphanEmptyBones = bones.some((b) => !usedAsParent.has(b.id));
  return { boneCount: bones.length, maxBoneDepth: maxDepth, hasOrphanEmptyBones };
};

const collectGeometryPairs = (
  nodes: readonly SceneNode[],
  visible: ReadonlySet<string>,
  sceneNodes: Readonly<Record<string, SceneNode>>,
  textures: Readonly<Record<string, TextureAsset>>,
  opacityCache: ReadonlyMap<string, TextureOpacityInfo>,
  chainCache: Map<string, readonly SceneNode[]>,
): {
  readonly obbs: AuditObb[];
  readonly pairs: Array<{ readonly node: CubeNode | PlaneNode; readonly obb: AuditObb }>;
  readonly min: Vec3;
  readonly max: Vec3;
} => {
  const obbs: AuditObb[] = [];
  const pairs: Array<{ readonly node: CubeNode | PlaneNode; readonly obb: AuditObb }> = [];
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const node of nodes) {
    if (!visible.has(node.id) || (node.kind !== 'cube' && node.kind !== 'plane')) continue;
    const chain = boneChain(sceneNodes, node, chainCache);
    const obb =
      node.kind === 'cube' ? cubeObb(node, chain, opacityCache) : planeObb(node, chain, textures);
    obbs.push(obb);
    pairs.push({ node, obb });
    for (let k = 0; k < 3; k += 1) {
      min[k] = Math.min(min[k]!, obb.aabbMin[k]!);
      max[k] = Math.max(max[k]!, obb.aabbMax[k]!);
    }
  }
  return {
    obbs,
    pairs,
    min: obbs.length > 0 ? min : [0, 0, 0],
    max: obbs.length > 0 ? max : [0, 0, 0],
  };
};

export const analyzeSceneGeometry = (
  scene: SceneGraph,
  textures: Readonly<Record<string, TextureAsset>>,
): AuditSceneGeometry => {
  const visible = collectVisibleNodeIds(scene);
  const nodes = Object.values(scene.nodes).sort((a, b) => compareText(a.id, b.id));
  const opacityCache = buildTextureOpacityCache(textures);
  const chainCache = new Map<string, readonly SceneNode[]>();
  const { obbs, pairs, min, max } = collectGeometryPairs(
    nodes,
    visible,
    scene.nodes,
    textures,
    opacityCache,
    chainCache,
  );
  const worldCenterY = obbs.length > 0 ? (min[1] + max[1]) * 0.5 : 0;
  const enabledFaces: AuditFaceBinding[] = [];
  for (const pair of pairs) collectNodeFaces(pair.node, pair.obb, worldCenterY, enabledFaces);
  const stats = boneStats(nodes, visible, scene.nodes, chainCache);
  return {
    visibleNodeIds: visible,
    obbs,
    enabledFaces,
    worldMin: min,
    worldMax: max,
    ...stats,
  };
};
