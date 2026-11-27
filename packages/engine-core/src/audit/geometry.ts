import { compareText } from '@ashfox/internal-contracts';
import { add3, sub3 } from '../math/vec3';
import type { Vec3 } from '../model/identity';
import {
  CUBE_FACE_DIRECTIONS,
  cubeGeometryPivot,
  cubeGeometryRotation,
  cubeUnrotatedBounds,
  type CubeNode,
  type CylinderNode,
  type PlaneNode,
  type SceneGraph,
  type SceneNode,
  type TaperNode,
  type WedgeNode,
} from '../model/scene';
import { isExpressionVariantNode } from '../model/expression';
import { canonicalRotatePoint } from '../model/transform';
import type { TextureAsset } from '../model/texture';
import {
  buildObbFromBasisPoints,
  buildTextureOpacityCache,
  collectNodeFaces,
  customPrimObb,
  hasAngledRotation,
  isOpaqueFace,
  toModelSpace,
  type AuditFaceBinding,
  type AuditObb,
  type TextureOpacityInfo,
} from './primObb';

export type { AuditFaceBinding, AuditObb } from './primObb';

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
  const opaque = CUBE_FACE_DIRECTIONS.every((dir) => isOpaqueFace(node.faces[dir], opacityCache));
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
    !isCutoutPlane(node, textures) && !isExpressionVariantNode(node),
    false,
  );
};

const boneStats = (
  nodes: readonly SceneNode[],
  visible: ReadonlySet<string>,
  sceneNodes: Readonly<Record<string, SceneNode>>,
  chainCache: Map<string, readonly SceneNode[]>,
) => {
  const bones = nodes.filter((n) => n.kind === 'bone' && visible.has(n.id));
  const usedAsParent = new Set(nodes.map((n) => n.parentId).filter((p): p is string => p !== null));
  let maxBoneDepth = 0;
  for (const bone of bones) {
    const chain = boneChain(sceneNodes, bone, chainCache);
    if (chain.length > maxBoneDepth) maxBoneDepth = chain.length;
  }
  return {
    boneCount: bones.length,
    maxBoneDepth,
    hasOrphanEmptyBones: bones.some((b) => !usedAsParent.has(b.id)),
  };
};

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

const collectVisibleGeomNodes = (
  nodes: readonly SceneNode[],
  visible: ReadonlySet<string>,
): Array<CubeNode | PlaneNode | TaperNode | WedgeNode | CylinderNode> =>
  nodes.filter(
    (n): n is CubeNode | PlaneNode | TaperNode | WedgeNode | CylinderNode =>
      visible.has(n.id) &&
      n.kind !== 'bone' &&
      n.kind !== 'locator' &&
      !(isExpressionVariantNode(n) && n.transform.scale.some((s) => Math.abs(s) <= 1e-6)),
  );

const buildNodeObb = (
  node: CubeNode | PlaneNode | TaperNode | WedgeNode | CylinderNode,
  chain: readonly SceneNode[],
  textures: Readonly<Record<string, TextureAsset>>,
  opacityCache: ReadonlyMap<string, TextureOpacityInfo>,
): AuditObb => {
  if (node.kind === 'cube') return cubeObb(node, chain, opacityCache);
  if (node.kind === 'plane') return planeObb(node, chain, textures);
  return customPrimObb(node, chain, opacityCache);
};

const collectGeometryPairs = (
  nodes: readonly SceneNode[],
  visible: ReadonlySet<string>,
  sceneNodes: Readonly<Record<string, SceneNode>>,
  textures: Readonly<Record<string, TextureAsset>>,
  opacityCache: ReadonlyMap<string, TextureOpacityInfo>,
  chainCache: Map<string, readonly SceneNode[]>,
) => {
  const obbs: AuditObb[] = [];
  const pairs: Array<{
    readonly node: CubeNode | PlaneNode | TaperNode | WedgeNode | CylinderNode;
    readonly obb: AuditObb;
  }> = [];
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const node of collectVisibleGeomNodes(nodes, visible)) {
    const obb = buildNodeObb(node, boneChain(sceneNodes, node, chainCache), textures, opacityCache);
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
    min: obbs.length > 0 ? min : ([0, 0, 0] as Vec3),
    max: obbs.length > 0 ? max : ([0, 0, 0] as Vec3),
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
