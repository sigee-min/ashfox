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

const EPS = 1e-6;
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, b: Vec3): Vec3 => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);
const norm = (v: Vec3): Vec3 => {
  const length = len(v);
  return length > EPS ? [v[0] / length, v[1] / length, v[2] / length] : [1, 0, 0];
};
const origin = (node: SceneNode): Vec3 => add(node.transform.pivot, node.transform.position);

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
  const visible = new Set<string>();
  for (const id of Object.keys(scene.nodes)) {
    if (isVisibleNode(scene.nodes, id, memo, new Set())) visible.add(id);
  }
  return visible;
};

const boneChain = (nodes: Readonly<Record<string, SceneNode>>, node: SceneNode): SceneNode[] => {
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
  return chain;
};

const toModelSpace = (localPoint: Vec3, chain: readonly SceneNode[]): Vec3 => {
  let point = localPoint;
  for (let i = 0; i < chain.length; i += 1) {
    const owner = chain[i]!;
    const parent = chain[i + 1];
    const translation = sub(origin(owner), parent ? origin(parent) : [0, 0, 0]);
    point = add(
      canonicalRotatePoint(mul(point, owner.transform.scale), owner.transform.rotation),
      translation,
    );
  }
  return point;
};

const cubeLocalPoint = (node: CubeNode, point: Vec3): Vec3 => {
  const pivot = cubeGeometryPivot(node);
  const rel = sub(point, pivot);
  return node.geometryMode === 'oriented-box'
    ? add(canonicalRotatePoint(rel, cubeGeometryRotation(node)), pivot)
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

const isOpaqueTexture = (tex: TextureAsset | undefined): boolean =>
  tex !== undefined &&
  tex.renderMode === 'default' &&
  tex.raster !== undefined &&
  tex.raster.backgroundAlpha === 255 &&
  tex.raster.canvasDetails.every((d) => d.alpha === 255) &&
  (tex.raster.alphaMasks === undefined || tex.raster.alphaMasks.length === 0);

const buildObbFromBasisPoints = (
  nodeId: string,
  parentId: string | null,
  p000: Vec3,
  p100: Vec3,
  p010: Vec3,
  p001: Vec3,
  angled: boolean,
  isPlane: boolean,
  opaque: boolean,
): AuditObb => {
  const vx = sub(p100, p000);
  const vy = sub(p010, p000);
  const vz = sub(p001, p000);
  const half: Vec3 = [len(vx) * 0.5, len(vy) * 0.5, len(vz) * 0.5];
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
    ax: norm(vx),
    ay: norm(vy),
    az: norm(vz),
    corners,
    aabbMin,
    aabbMax,
    volume: Math.max(0, half[0] * half[1] * half[2] * 8),
    angled,
    isPlane,
    opaque,
  };
};

const cubeObb = (
  node: CubeNode,
  chain: readonly SceneNode[],
  textures: Readonly<Record<string, TextureAsset>>,
): AuditObb => {
  const b = cubeUnrotatedBounds(node);
  const f = [b.from[0] - node.inflate, b.from[1] - node.inflate, b.from[2] - node.inflate] as const;
  const t = [b.to[0] + node.inflate, b.to[1] + node.inflate, b.to[2] + node.inflate] as const;
  const mapPt = (pt: Vec3): Vec3 => toModelSpace(cubeLocalPoint(node, pt), chain);
  const angled =
    hasAngledRotation(cubeGeometryRotation(node)) ||
    chain.some((entry) => hasAngledRotation(entry.transform.rotation));
  const opaque = CUBE_FACE_DIRECTIONS.every((dir) => {
    const face = node.faces[dir];
    return face.enabled && face.textureId !== null && isOpaqueTexture(textures[face.textureId]);
  });
  return buildObbFromBasisPoints(
    node.id,
    node.parentId,
    mapPt([f[0], f[1], f[2]]),
    mapPt([t[0], f[1], f[2]]),
    mapPt([f[0], t[1], f[2]]),
    mapPt([f[0], f[1], t[2]]),
    angled,
    false,
    opaque,
  );
};

const planeObb = (node: PlaneNode, chain: readonly SceneNode[]): AuditObb => {
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
    const ny = Math.abs(dot(obb.az, [0, 1, 0]));
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
): {
  readonly boneCount: number;
  readonly maxBoneDepth: number;
  readonly hasOrphanEmptyBones: boolean;
} => {
  const bones = nodes.filter((n) => n.kind === 'bone' && visible.has(n.id));
  const usedAsParent = new Set(nodes.map((n) => n.parentId).filter((p): p is string => p !== null));
  let maxDepth = 0;
  for (const bone of bones) {
    const chain = boneChain(sceneNodes, bone);
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
    const chain = boneChain(sceneNodes, node);
    const obb = node.kind === 'cube' ? cubeObb(node, chain, textures) : planeObb(node, chain);
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
  const nodes = Object.values(scene.nodes).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const { obbs, pairs, min, max } = collectGeometryPairs(nodes, visible, scene.nodes, textures);
  const worldCenterY = obbs.length > 0 ? (min[1] + max[1]) * 0.5 : 0;
  const enabledFaces: AuditFaceBinding[] = [];
  for (const pair of pairs) collectNodeFaces(pair.node, pair.obb, worldCenterY, enabledFaces);
  const stats = boneStats(nodes, visible, scene.nodes);
  return {
    visibleNodeIds: visible,
    obbs,
    enabledFaces,
    worldMin: min,
    worldMax: max,
    ...stats,
  };
};
