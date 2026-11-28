import { compareText } from '../../../stableOrder';
import {
  CUBE_FACE_DIRECTIONS,
  buildPrimitivePolygons,
  sealCanonicalBoneFrame,
  type BoneNode,
  type CubeFaceDirection,
  type CubeNode,
  type CylinderNode,
  type ProjectDocument,
  type SceneNode,
  type TaperNode,
  type Vec3,
  type WedgeNode,
} from '../../../model';
import { effectivelyVisibleSceneNodeIds } from '../../../sceneVisibility';
import type { CanonicalTextureRaster } from '../../../textures/textureRecipe/raster';
import { compileOpaqueCubeFaceOcclusion } from '../../occlusion/cube';
import { compileGltfCubePrimitiveData } from './cube';
import type { GltfSceneCompileOptions } from './graph';
import { resolveLod2FaceColor } from './lodMat';
import {
  ID_XF,
  LOD1_TRIS,
  LOD2_MAX_TRIS,
  SCALE,
  childrenOf,
  collectLodTextures,
  composeXf,
  computeModelBoundsAndPartSizes,
  filterLodAnims,
  selectCubes,
  xformPt,
  type ModelBoundsAnalysis,
  type ModelLod2Mesh,
  type ModelPartSize,
  type Xf,
} from './modelLodShell';
import { compileGltfCustomPrimitiveData } from './primMesh';
import { addVec3, isIdentityRotation, isIdentityScale, rotateVec3ByQuaternion } from './spatial';

export {
  computeModelBoundsAndPartSizes,
  type ModelBoundsAnalysis,
  type ModelLod2Mesh,
  type ModelPartSize,
};

const BONE_DROP = 0.55;

interface Lod2Ctx {
  doc: ProjectDocument;
  kids: ReadonlyMap<string | null, readonly SceneNode[]>;
  kept: ReadonlySet<string>;
  opts: GltfSceneCompileOptions;
  rasters: Map<string, CanonicalTextureRaster | null>;
  colorsCache: Map<string, Vec3>;
  positions: number[];
  normals: number[];
  colors: number[];
  indices: number[];
  partCount: number;
}

const boneDepth = (id: string, nodes: Readonly<Record<string, SceneNode>>) => {
  let d = 0;
  for (let c = nodes[id]; c && c.parentId !== null; c = nodes[c.parentId]) d += 1;
  return d;
};

const isLeafBone = (
  b: BoneNode,
  nodes: Readonly<Record<string, SceneNode>>,
  kids: ReadonlyMap<string, number>,
) =>
  Boolean(
    b.parentId &&
    nodes[b.parentId]?.kind === 'bone' &&
    (kids.get(b.id) ?? 0) === 0 &&
    isIdentityRotation(b.transform.rotation) &&
    isIdentityScale(b.transform.scale),
  );

const collectProtectedBones = (document: ProjectDocument): Set<string> => {
  const protectedBones = new Set<string>();
  const channels = Object.values(document.animations).flatMap((a) => Object.values(a.channels));
  for (const ch of channels) {
    let currId: string | null = ch.targetNodeId;
    while (currId !== null && !protectedBones.has(currId)) {
      protectedBones.add(currId);
      currId = document.scene.nodes[currId]?.parentId ?? null;
    }
  }
  return protectedBones;
};

const pickFlatBones = (
  nodes: Readonly<Record<string, SceneNode>>,
  vis: ReadonlySet<string>,
  kept: ReadonlySet<string>,
  a: ModelBoundsAnalysis,
  protectedBones: ReadonlySet<string>,
) => {
  const bones = Object.values(nodes).filter(
    (n): n is BoneNode => n.kind === 'bone' && vis.has(n.id),
  );
  if (bones.length <= 2) return new Map<string, string>();
  const [kids, vol] = [new Map<string, number>(), new Map<string, number>()];
  for (const b of bones) if (b.parentId) kids.set(b.parentId, (kids.get(b.parentId) ?? 0) + 1);
  for (const id of kept) {
    const pid = nodes[id]?.parentId;
    if (pid) vol.set(pid, (vol.get(pid) ?? 0) + (a.parts.get(id)?.volume ?? 0));
  }
  const target = Math.max(1, Math.round(bones.length * BONE_DROP));
  const cands = bones
    .filter((b) => !protectedBones.has(b.id) && isLeafBone(b, nodes, kids))
    .sort(
      (x, y) =>
        boneDepth(y.id, nodes) - boneDepth(x.id, nodes) ||
        (vol.get(x.id) ?? 0) - (vol.get(y.id) ?? 0) ||
        compareText(x.id, y.id),
    );
  return new Map(cands.slice(0, target).map((b) => [b.id, b.parentId!]));
};

const remapNode = (
  node: SceneNode,
  doc: ProjectDocument,
  kept: ReadonlySet<string>,
  flat: ReadonlyMap<string, string>,
): SceneNode | null => {
  if (
    node.kind === 'plane' ||
    ((node.kind === 'cube' ||
      node.kind === 'taper' ||
      node.kind === 'wedge' ||
      node.kind === 'cylinder') &&
      !kept.has(node.id))
  ) {
    return null;
  }
  if (node.kind === 'bone') {
    if (flat.has(node.id)) return null;
    const t = node.transform;
    const copy: BoneNode = {
      ...node,
      transform: {
        position: [...t.position],
        rotation: [...t.rotation],
        scale: [...t.scale],
        pivot: [...t.pivot],
      },
    };
    sealCanonicalBoneFrame(copy);
    return copy;
  }
  const fp = node.parentId ? flat.get(node.parentId) : undefined;
  const pn = fp && node.parentId ? doc.scene.nodes[node.parentId] : undefined;
  const pos = addVec3(node.transform.position, pn?.transform.position ?? [0, 0, 0]);
  return {
    ...node,
    parentId: fp ?? node.parentId,
    transform: { ...node.transform, position: pos },
  };
};

/** Produces a simplified LOD1 ProjectDocument by pruning small parts and flattening leaf bones. */
export const buildModelLod1Document = (document: ProjectDocument): ProjectDocument => {
  const vis = effectivelyVisibleSceneNodeIds(document);
  const analysis = computeModelBoundsAndPartSizes(document);
  const kept = selectCubes(analysis);
  const protectedBones = collectProtectedBones(document);
  const flat = pickFlatBones(document.scene.nodes, vis, kept, analysis, protectedBones);
  const nodes: Record<string, SceneNode> = {};
  for (const node of Object.values(document.scene.nodes)) {
    const out = vis.has(node.id) ? remapNode(node, document, kept, flat) : null;
    if (out) nodes[node.id] = out;
  }
  return {
    ...document,
    scene: { roots: document.scene.roots.filter((id) => Boolean(nodes[id])), nodes },
    textures: collectLodTextures(document, nodes),
    animations: filterLodAnims(document, nodes),
  };
};

const faceColor = (
  ctx: Lod2Ctx,
  dir: CubeFaceDirection,
  tid: string | null,
  uv?: readonly [number, number, number, number],
) => resolveLod2FaceColor(ctx.doc, ctx.rasters, ctx.colorsCache, dir, tid, uv);

const appendLod2Prims = (
  ctx: Lod2Ctx,
  node: CubeNode | TaperNode | WedgeNode | CylinderNode,
  xf: Xf,
): void => {
  const prims =
    node.kind === 'cube'
      ? compileGltfCubePrimitiveData(ctx.doc, node, ctx.opts)
      : compileGltfCustomPrimitiveData(ctx.doc, node, ctx.opts);
  const dirs: readonly CubeFaceDirection[] =
    node.kind === 'cube'
      ? CUBE_FACE_DIRECTIONS.filter(
          (d) => node.faces[d].enabled && !ctx.opts.cubeFaceOcclusion?.get(node.id)?.has(d),
        )
      : buildPrimitivePolygons(node)
          .filter((p) => node.faces[p.direction].enabled && p.vertices.length >= 3)
          .map((p) => p.direction);
  const mirror = xf.scale[0] * xf.scale[1] * xf.scale[2] < 0;
  for (let pIdx = 0; pIdx < prims.length; pIdx += 1) {
    const [prim, dir] = [prims[pIdx]!, dirs[pIdx]!];
    const rgb = faceColor(ctx, dir, node.faces[dir].textureId, node.faces[dir].uv);
    const base = ctx.positions.length / 3;
    for (let i = 0; i < prim.positions.length; i += 3) {
      const p = xformPt([prim.positions[i]!, prim.positions[i + 1]!, prim.positions[i + 2]!], xf);
      const n = rotateVec3ByQuaternion(
        [prim.normals[i]!, prim.normals[i + 1]!, prim.normals[i + 2]!],
        xf.rot,
      );
      const len = Math.hypot(n[0], n[1], n[2]) || 1;
      ctx.positions.push(p[0], p[1], p[2]);
      ctx.normals.push(n[0] / len, n[1] / len, n[2] / len);
      ctx.colors.push(rgb[0]!, rgb[1]!, rgb[2]!);
    }
    for (let i = 0; i + 2 < prim.indices.length; i += 3) {
      const [b1, b2] = mirror
        ? [prim.indices[i + 2]!, prim.indices[i + 1]!]
        : [prim.indices[i + 1]!, prim.indices[i + 2]!];
      ctx.indices.push(base + prim.indices[i]!, base + b1, base + b2);
    }
  }
};

const walkLod2 = (ctx: Lod2Ctx, node: SceneNode, pXf: Xf): void => {
  const xf = composeXf(pXf, ctx.doc, node);
  if (
    (node.kind === 'cube' ||
      node.kind === 'taper' ||
      node.kind === 'wedge' ||
      node.kind === 'cylinder') &&
    ctx.kept.has(node.id)
  ) {
    appendLod2Prims(ctx, node, xf);
    ctx.partCount += 1;
  }
  for (const ch of ctx.kids.get(node.id) ?? []) walkLod2(ctx, ch, xf);
};

/** Builds a baked vertex-colored LOD2 silhouette mesh for a ProjectDocument. */
export const buildModelLod2Mesh = (document: ProjectDocument): ModelLod2Mesh => {
  const vis = effectivelyVisibleSceneNodeIds(document);
  const a = computeModelBoundsAndPartSizes(document);
  const opts: GltfSceneCompileOptions = {
    writer: undefined as never,
    materialByTextureId: new Map(),
    singleSidedMaterialByTextureId: new Map(),
    unitScale: SCALE,
    cubeFaceOcclusion: compileOpaqueCubeFaceOcclusion(document),
  };
  const ctx: Lod2Ctx = {
    doc: document,
    kids: childrenOf(document, vis),
    kept: selectCubes(a, Math.min(a.lod0TriCount * LOD1_TRIS, LOD2_MAX_TRIS)),
    opts,
    rasters: new Map(),
    colorsCache: new Map(),
    positions: [],
    normals: [],
    colors: [],
    indices: [],
    partCount: 0,
  };
  for (const rid of document.scene.roots)
    if (document.scene.nodes[rid] && vis.has(rid)) walkLod2(ctx, document.scene.nodes[rid]!, ID_XF);
  return {
    positions: ctx.positions,
    normals: ctx.normals,
    colors: ctx.colors,
    indices: ctx.indices,
    partCount: ctx.partCount,
    boundingSphere: a.boundingSphere,
  };
};
