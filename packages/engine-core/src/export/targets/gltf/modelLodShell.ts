import { compareText } from '../../../stableOrder';
import {
  CUBE_FACE_DIRECTIONS,
  cubeGeometryPivot,
  cubeUnrotatedBounds,
  type CubeNode,
  type CylinderNode,
  type ProjectDocument,
  type SceneNode,
  type TaperNode,
  type TextureAsset,
  type Vec3,
  type WedgeNode,
} from '../../../model';
import { effectivelyVisibleSceneNodeIds } from '../../../sceneVisibility';
import { compileOpaqueCubeFaceOcclusion, type CubeFaceOcclusion } from '../../occlusion/cube';
import { measureCustomPrimMetrics } from './primMesh';
import { gltfNodeGeometryRotation } from './rigid';
import {
  addVec3,
  isIdentityRotation,
  multiplyVec3,
  quaternionFromEuler,
  rotateVec3ByQuaternion,
  subtractVec3,
} from './spatial';

export const [SCALE, SMALL_VOL, LOD1_TRIS, LOD2_MAX_TRIS] = [1 / 16, 0.015, 0.55, 60];

export interface ModelPartSize {
  readonly id: string;
  readonly kind: 'cube' | 'plane' | 'taper' | 'wedge' | 'cylinder';
  readonly volume: number;
  readonly triCount: number;
}
export interface ModelBoundsAnalysis {
  readonly totalPartVolume: number;
  readonly boundingBoxVolume: number;
  readonly boundingSphere: readonly [number, number, number, number];
  readonly bounds: { readonly min: Vec3; readonly max: Vec3 };
  readonly parts: ReadonlyMap<string, ModelPartSize>;
  readonly lod0TriCount: number;
}
export interface ModelLod2Mesh {
  readonly positions: readonly number[];
  readonly normals: readonly number[];
  readonly colors: readonly number[];
  readonly indices: readonly number[];
  readonly partCount: number;
  readonly boundingSphere: readonly [number, number, number, number];
}
export interface Xf {
  pos: Vec3;
  rot: readonly [number, number, number, number];
  scale: Vec3;
}
interface BoundsCtx {
  doc: ProjectDocument;
  kids: ReadonlyMap<string | null, readonly SceneNode[]>;
  occ: CubeFaceOcclusion;
  parts: Map<string, ModelPartSize>;
  min: [number, number, number];
  max: [number, number, number];
  vol: number;
  tris: number;
}

export const ID_XF: Xf = { pos: [0, 0, 0], rot: [0, 0, 0, 1], scale: [1, 1, 1] };

/** Transforms a local-space point by an accumulated world transform. */
export const xformPt = (pt: Vec3, xf: Xf): Vec3 =>
  addVec3(
    rotateVec3ByQuaternion([pt[0] * xf.scale[0], pt[1] * xf.scale[1], pt[2] * xf.scale[2]], xf.rot),
    xf.pos,
  );

const mulQuat = (
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): readonly [number, number, number, number] => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

/** Composes a scene node's local transform onto its parent transform. */
export const composeXf = (p: Xf, doc: ProjectDocument, n: SceneNode): Xf => {
  const pn = n.parentId ? doc.scene.nodes[n.parentId] : undefined;
  const pOrg: Vec3 =
    pn?.kind === 'bone' ? addVec3(pn.transform.pivot, pn.transform.position) : [0, 0, 0];
  const piv = n.kind === 'cube' ? cubeGeometryPivot(n) : n.transform.pivot;
  const raw =
    n.kind === 'locator'
      ? n.transform.position
      : subtractVec3(addVec3(piv, n.transform.position), pOrg);
  const loc = multiplyVec3(raw, SCALE);
  const rotT = rotateVec3ByQuaternion(
    [loc[0] * p.scale[0], loc[1] * p.scale[1], loc[2] * p.scale[2]],
    p.rot,
  );
  const rv = gltfNodeGeometryRotation(n);
  const s = n.transform.scale;
  return {
    pos: addVec3(p.pos, rotT),
    rot: isIdentityRotation(rv) ? p.rot : mulQuat(p.rot, quaternionFromEuler(rv)),
    scale: [p.scale[0] * s[0], p.scale[1] * s[1], p.scale[2] * s[2]],
  };
};

/** Groups visible scene nodes by parentId in deterministic sorted order. */
export const childrenOf = (doc: ProjectDocument, vis: ReadonlySet<string>) => {
  const map = new Map<string | null, SceneNode[]>();
  for (const n of Object.values(doc.scene.nodes)) {
    if (!vis.has(n.id)) continue;
    const list = map.get(n.parentId) ?? [];
    list.push(n);
    map.set(n.parentId, list);
  }
  for (const list of map.values()) list.sort((a, b) => compareText(a.id, b.id));
  return map;
};

const measureCubeNode = (ctx: BoundsCtx, node: CubeNode, xf: Xf): void => {
  const [b, p] = [cubeUnrotatedBounds(node), cubeGeometryPivot(node)];
  const lo = [0, 1, 2].map((i) => (b.from[i]! - p[i]! - node.inflate) * SCALE);
  const hi = [0, 1, 2].map((i) => (b.to[i]! - p[i]! + node.inflate) * SCALE);
  for (let m = 0; m < 8; m += 1) {
    const w = xformPt(
      [m & 1 ? hi[0]! : lo[0]!, m & 2 ? hi[1]! : lo[1]!, m & 4 ? hi[2]! : lo[2]!],
      xf,
    );
    for (let i = 0; i < 3; i += 1)
      [ctx.min[i], ctx.max[i]] = [Math.min(ctx.min[i]!, w[i]!), Math.max(ctx.max[i]!, w[i]!)];
  }
  const faces = CUBE_FACE_DIRECTIONS.filter(
    (d) => node.faces[d].enabled && !ctx.occ.get(node.id)?.has(d),
  ).length;
  const vol =
    ((hi[0]! - lo[0]!) *
      Math.abs(xf.scale[0]) *
      (hi[1]! - lo[1]!) *
      Math.abs(xf.scale[1]) *
      (hi[2]! - lo[2]!) *
      Math.abs(xf.scale[2])) /
    SCALE ** 3;
  ctx.parts.set(node.id, { id: node.id, kind: 'cube', volume: vol, triCount: faces * 2 });
  ctx.vol += vol;
  ctx.tris += faces * 2;
};

const measureCustomPrimNode = (
  ctx: BoundsCtx,
  node: TaperNode | WedgeNode | CylinderNode,
  xf: Xf,
): void => {
  const { worldPts, volume, triCount } = measureCustomPrimMetrics(node, SCALE, xf.scale, (l) =>
    xformPt(l, xf),
  );
  for (const w of worldPts) {
    for (let i = 0; i < 3; i += 1) {
      [ctx.min[i], ctx.max[i]] = [Math.min(ctx.min[i]!, w[i]!), Math.max(ctx.max[i]!, w[i]!)];
    }
  }
  ctx.parts.set(node.id, { id: node.id, kind: node.kind, volume, triCount });
  ctx.vol += volume;
  ctx.tris += triCount;
};

const walkBounds = (ctx: BoundsCtx, node: SceneNode, pXf: Xf): void => {
  const xf = composeXf(pXf, ctx.doc, node);
  if (node.kind === 'cube') measureCubeNode(ctx, node, xf);
  else if (node.kind === 'taper' || node.kind === 'wedge' || node.kind === 'cylinder') {
    measureCustomPrimNode(ctx, node, xf);
  } else if (node.kind === 'plane') {
    const triCount = node.sidedness === 'double' ? 4 : 2;
    ctx.parts.set(node.id, { id: node.id, kind: 'plane', volume: 0, triCount });
    ctx.tris += triCount;
  }
  for (const ch of ctx.kids.get(node.id) ?? []) walkBounds(ctx, ch, xf);
};

/** Computes bounding box/sphere, part volumes, and LOD0 triangle counts for a ProjectDocument. */
export const computeModelBoundsAndPartSizes = (document: ProjectDocument): ModelBoundsAnalysis => {
  const vis = effectivelyVisibleSceneNodeIds(document);
  const ctx: BoundsCtx = {
    doc: document,
    kids: childrenOf(document, vis),
    occ: compileOpaqueCubeFaceOcclusion(document),
    parts: new Map(),
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
    vol: 0,
    tris: 0,
  };
  for (const rid of document.scene.roots)
    if (document.scene.nodes[rid] && vis.has(rid))
      walkBounds(ctx, document.scene.nodes[rid]!, ID_XF);
  const ok = Number.isFinite(ctx.min[0]);
  const [min, max]: [Vec3, Vec3] = ok
    ? [[...ctx.min], [...ctx.max]]
    : [
        [0, 0, 0],
        [0, 0, 0],
      ];
  const [dx, dy, dz] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const sphere: [number, number, number, number] = [
    (min[0] + max[0]) * 0.5,
    (min[1] + max[1]) * 0.5,
    (min[2] + max[2]) * 0.5,
    Math.max(ok ? 0.1 : 0.5, Math.hypot(dx, dy, dz) * 0.5),
  ];
  return {
    totalPartVolume: ctx.vol,
    boundingBoxVolume: dx * dy * dz,
    boundingSphere: sphere,
    bounds: { min, max },
    parts: ctx.parts,
    lod0TriCount: ctx.tris,
  };
};

/** Selects retained volumetric parts up to a target triangle budget for LOD simplification. */
export const selectCubes = (
  a: ModelBoundsAnalysis,
  maxTris = a.lod0TriCount * LOD1_TRIS,
): ReadonlySet<string> => {
  const cubes = [...a.parts.values()].filter((p) => p.kind !== 'plane');
  const kept = cubes.filter((p) => p.volume >= a.totalPartVolume * SMALL_VOL);
  const work = kept.length > 0 ? kept : cubes;
  let tris = work.reduce((s, p) => s + p.triCount, 0);
  if (tris <= maxTris || work.length <= 2) return new Set(work.map((p) => p.id));
  const sorted = [...work].sort((x, y) => x.volume - y.volume || compareText(x.id, y.id));
  while (tris > maxTris && sorted.length > 2) tris -= sorted.shift()!.triCount;
  return new Set(sorted.map((p) => p.id));
};

/** Collects textures referenced by retained LOD1 scene nodes. */
export const collectLodTextures = (
  doc: ProjectDocument,
  nodes: Readonly<Record<string, SceneNode>>,
): Record<string, TextureAsset> => {
  const textures: Record<string, TextureAsset> = {};
  for (const out of Object.values(nodes)) {
    if (out.kind === 'bone' || out.kind === 'locator' || out.kind === 'plane') continue;
    for (const d of CUBE_FACE_DIRECTIONS) {
      const tid = out.faces[d].textureId;
      if (tid && doc.textures[tid]) textures[tid] = doc.textures[tid]!;
    }
  }
  return textures;
};

/** Filters animation clips to channels targeting retained LOD1 nodes. */
export const filterLodAnims = (
  doc: ProjectDocument,
  nodes: Readonly<Record<string, SceneNode>>,
): Record<string, ProjectDocument['animations'][string]> => {
  const animations: Record<string, ProjectDocument['animations'][string]> = {};
  for (const [cid, clip] of Object.entries(doc.animations)) {
    const channels: Record<string, (typeof clip.channels)[string]> = {};
    for (const [chid, ch] of Object.entries(clip.channels)) {
      if (nodes[ch.targetNodeId]) channels[chid] = ch;
    }
    if (Object.keys(channels).length > 0) animations[cid] = { ...clip, channels };
  }
  return animations;
};
