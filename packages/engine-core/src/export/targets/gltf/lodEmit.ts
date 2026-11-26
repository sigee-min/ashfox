import type { StructureBakedBatch, StructureProduct } from '../../../compiler/structure/contract';
import type { ProjectDocument } from '../../../model';
import type { TextureAsset } from '../../../model/texture';
import { compareText } from '../../../stableOrder';
import { encodeCanonicalPng } from '../../../textures/textureRecipe/png';
import { rasterizeTextureSpec } from '../../../textures/textureRecipe/raster';
import { GltfBinaryWriter } from './binary';
import type { CompiledGltf } from './build';
import type { GltfDocument, GltfExtensionName, GltfMaterial, GltfNode, GltfSkin } from './contract';
import {
  buildModelLod1Document,
  buildModelLod2Mesh,
  computeModelBoundsAndPartSizes,
} from './modelLod';
import { compileQuantizedGltfPrimitive } from './primitive';
import { emitLod1PropNodes } from './propNode';
import { compileGltfScene } from './scene';
import { computePositionsBounds, type PositionBounds, type UvTransform } from './vertexLayout';

export const DEFAULT_STRUCTURE_LOD_DISTANCES: readonly [number, number, number] = [0, 28, 75];
export const DEFAULT_MODEL_LOD_DISTANCES: readonly [number, number, number] = [0, 18, 45];
export const DEFAULT_LOD_HYSTERESIS = 2.5;
const ATTR_KEYS = ['POSITION', 'NORMAL', 'TEXCOORD_0', 'COLOR_0', 'JOINTS_0', 'WEIGHTS_0'] as const;

export interface AshfoxLodMetadata {
  readonly distances: readonly number[];
  readonly hysteresis: number;
  readonly boundingSphere: readonly [number, number, number, number];
}
export type GltfLodNode = GltfNode;
export type GltfLodDocument = GltfDocument;
export interface CompiledGltfWithLod {
  readonly document: GltfLodDocument;
  readonly binary: Uint8Array;
  readonly textureFiles: CompiledGltf['textureFiles'];
}
export interface AttachLodOptions {
  readonly distances?: readonly [number, number, number];
  readonly hysteresis?: number;
  readonly quantize?: boolean;
  readonly customBounds?: ReadonlyMap<string, PositionBounds>;
}
interface QMesh {
  meshIdx: number;
  bounds: PositionBounds;
}
type State = {
  writer: GltfBinaryWriter;
  baseMeshes: number;
  baseNodes: number;
  bvOff: number;
  aOff: number;
  nodes: GltfLodNode[];
  meshes: NonNullable<GltfDocument['meshes']>;
  images: NonNullable<GltfDocument['images']>;
  samplers: NonNullable<GltfDocument['samplers']>;
  textures: NonNullable<GltfDocument['textures']>;
  materials: GltfMaterial[];
  skins: GltfSkin[];
  usesTextureTransform: boolean;
  usesGpuInstancing: boolean;
};

const initState = (c: CompiledGltf, opts: AttachLodOptions): State => {
  const d = c.document;
  const q = opts.quantize ?? d.extensionsUsed?.includes('KHR_mesh_quantization') ?? true;
  return {
    writer: new GltfBinaryWriter(q),
    baseMeshes: d.meshes?.length ?? 0,
    baseNodes: d.nodes.length,
    bvOff: d.bufferViews?.length ?? 0,
    aOff: d.accessors?.length ?? 0,
    nodes: d.nodes.map((n) => ({ ...n })),
    meshes: [...(d.meshes ?? [])],
    images: [...(d.images ?? [])],
    samplers: [...(d.samplers ?? [])],
    textures: [...(d.textures ?? [])],
    materials: [...(d.materials ?? [])],
    skins: [...(d.skins ?? [])],
    usesTextureTransform: false,
    usesGpuInstancing: false,
  };
};

export const buildLodDocumentMetadata = (
  distances: readonly [number, number, number],
  boundingSphere: readonly [number, number, number, number],
  hysteresis = DEFAULT_LOD_HYSTERESIS,
): AshfoxLodMetadata => ({
  distances: [...distances],
  hysteresis,
  boundingSphere: [...boundingSphere],
});

const trScaleOf = (st: State, b: PositionBounds) =>
  st.writer.isQuantized
    ? {
        translation: [...b.center] as [number, number, number],
        scale: [...b.halfExtent] as [number, number, number],
      }
    : {};

const colorMesh = (
  st: State,
  name: string,
  matName: string,
  p: readonly number[],
  n: readonly number[],
  idx: readonly number[],
  col?: readonly number[],
): QMesh | undefined => {
  if (idx.length === 0 || p.length === 0) return undefined;
  let mid = st.materials.findIndex(
    (m) => m.name === matName && !m.pbrMetallicRoughness.baseColorTexture,
  );
  if (mid < 0)
    mid =
      st.materials.push({
        name: matName,
        pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 1 },
      }) - 1;
  const bounds = computePositionsBounds([p]);
  const prim = compileQuantizedGltfPrimitive(
    st.writer,
    p,
    n,
    undefined,
    idx,
    bounds,
    () => mid,
    col?.length ? col : undefined,
  );
  return { meshIdx: st.meshes.push({ name, primitives: [prim] }) - 1, bounds };
};

const shiftPrimitiveAccessors = (
  p: NonNullable<GltfDocument['meshes']>[number]['primitives'][number],
  aOff: number,
) => {
  if (p.indices !== undefined) p.indices += aOff;
  for (const k of ATTR_KEYS) if (p.attributes[k] !== undefined) p.attributes[k]! += aOff;
};

const shiftInstancedNodeAccessors = (node: GltfNode, aOff: number) => {
  const attrs = node.extensions?.EXT_mesh_gpu_instancing?.attributes;
  if (!attrs) return;
  attrs.TRANSLATION += aOff;
  if (attrs.ROTATION !== undefined) attrs.ROTATION += aOff;
  if (attrs.SCALE !== undefined) attrs.SCALE += aOff;
};

const shiftMeshAccessors = (st: State) => {
  if (st.aOff === 0) return;
  for (let i = st.baseMeshes; i < st.meshes.length; i += 1) {
    for (const p of st.meshes[i]!.primitives) shiftPrimitiveAccessors(p, st.aOff);
  }
  for (let i = st.baseNodes; i < st.nodes.length; i += 1) {
    shiftInstancedNodeAccessors(st.nodes[i]!, st.aOff);
  }
};

const finalize = (c: CompiledGltf, st: State, rootNodes: number[]): CompiledGltfWithLod => {
  shiftMeshAccessors(st);
  const [baseLen, tail] = [(c.binary.byteLength + 3) & ~3, st.writer.toUint8Array()];
  const binary = new Uint8Array(baseLen + tail.byteLength);
  binary.set(c.binary, 0);
  binary.set(tail, baseLen);
  const bv = c.document.bufferViews ?? [];
  const used = new Set<GltfExtensionName>([...(c.document.extensionsUsed ?? []), 'MSFT_lod']);
  const req = new Set<GltfExtensionName>(c.document.extensionsRequired ?? []);
  if (st.writer.state.usesMeshQuantization)
    [used.add('KHR_mesh_quantization'), req.add('KHR_mesh_quantization')];
  if (st.usesTextureTransform) used.add('KHR_texture_transform');
  if (st.usesGpuInstancing) used.add('EXT_mesh_gpu_instancing');
  const newBv = st.writer.state.bufferViews.map((v) => ({
    ...v,
    byteOffset: (v.byteOffset ?? 0) + baseLen,
  }));
  const newAcc = st.writer.state.accessors.map((a) => ({
    ...a,
    bufferView: a.bufferView + bv.length,
  }));
  const doc: GltfLodDocument = {
    ...c.document,
    extensionsUsed: [...used],
    scenes: [{ ...(c.document.scenes[0] ?? {}), nodes: rootNodes }],
    nodes: st.nodes,
    buffers: [{ ...(c.document.buffers?.[0] ?? {}), byteLength: binary.byteLength }],
    bufferViews: [...bv, ...newBv],
    accessors: [...(c.document.accessors ?? []), ...newAcc],
    meshes: st.meshes,
  };
  if (req.size) doc.extensionsRequired = [...req];
  if (st.images.length)
    Object.assign(doc, { images: st.images, samplers: st.samplers, textures: st.textures });
  if (st.materials.length) doc.materials = st.materials;
  if (st.skins.length) doc.skins = st.skins;
  return { document: doc, binary, textureFiles: c.textureFiles };
};

const ensureLodTexture = (st: State, tex: TextureAsset): number | undefined => {
  const existing = st.textures.findIndex((t) => t.name === tex.name);
  if (existing >= 0) return existing;
  if (!tex.raster) return undefined;
  const png = encodeCanonicalPng(rasterizeTextureSpec(tex.width, tex.height, tex.raster));
  const img =
    st.images.push({
      bufferView: st.bvOff + st.writer.addBufferView(png),
      mimeType: 'image/png',
      name: tex.name,
    }) - 1;
  const f = tex.sampling === 'nearest' ? 9728 : 9729;
  const samp = st.samplers.push({ magFilter: f, minFilter: f, wrapS: 10497, wrapT: 10497 }) - 1;
  return st.textures.push({ sampler: samp, source: img, name: tex.name }) - 1;
};

const resolveMat = (
  st: State,
  tex: TextureAsset | undefined,
  layer: StructureBakedBatch['layer'],
  mats: Map<string, number>,
  uvTx?: UvTransform,
) => {
  if (!tex) return undefined;
  const uvKey = uvTx ? `:uv(${uvTx.offset.join(',')},${uvTx.scale.join(',')})` : '';
  const key = `${tex.name}:${layer}${uvKey}`;
  const hit = mats.get(key);
  if (hit !== undefined) return hit;
  const tid = ensureLodTexture(st, tex);
  if (tid === undefined) return undefined;
  if (uvTx) st.usesTextureTransform = true;
  const ext = uvTx
    ? {
        KHR_texture_transform: {
          offset: [...uvTx.offset] as [number, number],
          scale: [...uvTx.scale] as [number, number],
        },
      }
    : undefined;
  const texInfo = ext ? { index: tid, extensions: ext } : { index: tid };
  const mat: GltfMaterial = {
    name: tex.name,
    pbrMetallicRoughness: { baseColorTexture: texInfo, metallicFactor: 0, roughnessFactor: 1 },
    ...(layer === 'emissive' || tex.renderMode === 'emissive'
      ? { emissiveTexture: texInfo, emissiveFactor: [1, 1, 1] as [number, number, number] }
      : {}),
    ...(layer === 'cutout'
      ? { alphaMode: 'MASK' as const, alphaCutoff: 0.5, doubleSided: true }
      : {}),
  };
  const mid = st.materials.push(mat) - 1;
  mats.set(key, mid);
  return mid;
};

const buildStructLod1 = (product: StructureProduct, st: State): QMesh | undefined => {
  const lod1 = product.lodLevels?.lod1;
  const active = lod1?.batches.filter((b) => b.indices.length > 0 && b.positions.length > 0) ?? [];
  if (!lod1 || active.length === 0) return undefined;
  const mats = new Map<string, number>();
  st.materials.forEach(
    (m, i) =>
      m.name &&
      !m.pbrMetallicRoughness.baseColorTexture?.extensions?.KHR_texture_transform &&
      mats.set(
        `${m.name}:${m.alphaMode === 'MASK' ? 'cutout' : m.emissiveTexture ? 'emissive' : 'opaque'}`,
        i,
      ),
  );
  const bounds = computePositionsBounds(active.map((b) => b.positions));
  const prims = active.map((b) =>
    compileQuantizedGltfPrimitive(
      st.writer,
      b.positions,
      b.normals,
      b.uvs.length ? b.uvs : undefined,
      b.indices,
      bounds,
      (uvTx) => resolveMat(st, lod1.textures[b.textureId], b.layer, mats, uvTx),
      b.colors.length ? b.colors : undefined,
    ),
  );
  return { meshIdx: st.meshes.push({ name: `${product.id}_lod1`, primitives: prims }) - 1, bounds };
};

const collectStructLod1Kids = (
  product: StructureProduct,
  st: State,
  customBounds?: ReadonlyMap<string, PositionBounds>,
): number[] => {
  const propRes = emitLod1PropNodes(st.nodes, st.meshes, st.writer, product, customBounds);
  if (propRes.usesGpuInstancing) st.usesGpuInstancing = true;
  const l1Voxel = buildStructLod1(product, st);
  const l1Kids = [...propRes.props];
  if (l1Voxel) {
    l1Kids.unshift(
      st.nodes.push({
        name: `${product.id}_lod1_voxels`,
        mesh: l1Voxel.meshIdx,
        ...trScaleOf(st, l1Voxel.bounds),
      }) - 1,
    );
  }
  return l1Kids;
};

export const attachStructureLods = (
  compiled: CompiledGltf,
  product: StructureProduct,
  options: AttachLodOptions = {},
): CompiledGltfWithLod => {
  const lods = product.lodLevels;
  if (!lods || compiled.document.extensionsUsed?.includes('MSFT_lod'))
    return {
      ...compiled,
      document: { ...compiled.document, nodes: compiled.document.nodes.map((n) => ({ ...n })) },
    };
  const st = initState(compiled, options);
  const l1Kids = collectStructLod1Kids(product, st, options.customBounds);
  const b2 = lods.lod2.batches.find((b) => b.indices.length > 0 && b.positions.length > 0);
  const l2Voxel = b2
    ? colorMesh(
        st,
        `${product.id}_lod2`,
        `${product.id}_lod2_horizon`,
        b2.positions,
        b2.normals,
        b2.indices,
        b2.colors,
      )
    : undefined;
  const [w, h, d] = product.grid.size;
  const meta = buildLodDocumentMetadata(
    options.distances ?? DEFAULT_STRUCTURE_LOD_DISTANCES,
    [0, h * 0.5, 0, Math.hypot(w, h, d) * 0.5],
    options.hysteresis,
  );
  const l1Idx =
    st.nodes.push({ name: `${product.id}_LOD1`, ...(l1Kids.length ? { children: l1Kids } : {}) }) -
    1;
  const l2Idx =
    st.nodes.push({
      name: `${product.id}_LOD2`,
      ...(l2Voxel ? { mesh: l2Voxel.meshIdx, ...trScaleOf(st, l2Voxel.bounds) } : {}),
    }) - 1;
  const l0C = compiled.document.scenes[0]?.nodes ?? [0];
  const l0Idx =
    st.nodes.push({
      name: `${product.id}_LOD0`,
      ...(l0C.length ? { children: [...l0C] } : {}),
      extensions: { MSFT_lod: { ids: [l1Idx, l2Idx] } },
      extras: { MSFT_screencoverage: [0.5, 0.2, 0.05] },
    }) - 1;
  const wrapIdx =
    st.nodes.push({
      name: product.id,
      children: [l0Idx, l1Idx, l2Idx],
      extras: { ashfox: { lod: meta } },
    }) - 1;
  return finalize(compiled, st, [wrapIdx]);
};

const appendLod1Model = (
  doc: ProjectDocument,
  st: State,
  baseById: ReadonlyMap<string, number>,
) => {
  const [matMap, ssMap] = [new Map<string, number>(), new Map<string, number>()];
  for (const t of Object.values(doc.textures).sort((a, b) => compareText(a.id, b.id))) {
    const i = st.materials.findIndex((m) => m.name === t.name);
    const s = st.materials.findIndex((m) => m.name === `${t.name} (front-sided)`);
    if (i >= 0) matMap.set(t.id, i);
    if (s >= 0) ssMap.set(t.id, s);
  }
  const l1 = compileGltfScene(buildModelLod1Document(doc), {
    writer: st.writer,
    materialByTextureId: matMap,
    singleSidedMaterialByTextureId: ssMap,
    unitScale: 1 / 16,
  });
  const [mOff, sOff] = [st.meshes.length, st.skins.length];
  st.meshes.push(...l1.meshes);
  const mapJoint = (j: number) => baseById.get(l1.nodes[j]?.extras?.ashfoxId ?? '') ?? j;
  for (const s of l1.skins) {
    const c: GltfSkin = { ...s, joints: s.joints.map(mapJoint) };
    if (c.inverseBindMatrices !== undefined) c.inverseBindMatrices += st.aOff;
    if (c.skeleton !== undefined) c.skeleton = mapJoint(c.skeleton);
    st.skins.push(c);
  }
  return l1.nodes
    .filter((n) => n.mesh !== undefined)
    .map((n) => ({
      ...n,
      mesh: n.mesh! + mOff,
      ...(n.skin !== undefined ? { skin: n.skin + sOff } : {}),
    }));
};

const pushLod1ModelNode = (st: State, id: string, meshes: GltfLodNode[]): number => {
  if (meshes.length <= 1) return st.nodes.push({ ...(meshes[0] ?? {}), name: `${id}_LOD1` }) - 1;
  const children = meshes.map((m) => st.nodes.push({ ...m }) - 1);
  return st.nodes.push({ name: `${id}_LOD1`, children }) - 1;
};

export const attachModelLods = (
  compiled: CompiledGltf,
  sourceDocument: ProjectDocument,
  options: AttachLodOptions = {},
): CompiledGltfWithLod => {
  if (compiled.document.extensionsUsed?.includes('MSFT_lod'))
    return {
      ...compiled,
      document: { ...compiled.document, nodes: compiled.document.nodes.map((n) => ({ ...n })) },
    };
  const st = initState(compiled, options);
  const baseById = new Map<string, number>();
  st.nodes.forEach((n, i) => n.extras?.ashfoxId && baseById.set(n.extras.ashfoxId, i));
  const [l1Meshes, l2] = [
    appendLod1Model(sourceDocument, st, baseById),
    buildModelLod2Mesh(sourceDocument),
  ];
  const l1Idx = pushLod1ModelNode(st, sourceDocument.id, l1Meshes);
  const l2Res = colorMesh(
    st,
    `${sourceDocument.id}_lod2`,
    `${sourceDocument.id}_lod2_proxy`,
    l2.positions,
    l2.normals,
    l2.indices,
    l2.colors,
  );
  const l2Idx =
    st.nodes.push({
      name: `${sourceDocument.id}_LOD2`,
      ...(l2Res ? { mesh: l2Res.meshIdx, ...trScaleOf(st, l2Res.bounds) } : {}),
    }) - 1;
  const meta = buildLodDocumentMetadata(
    options.distances ?? DEFAULT_MODEL_LOD_DISTANCES,
    computeModelBoundsAndPartSizes(sourceDocument).boundingSphere,
    options.hysteresis,
  );
  const roots = [...(compiled.document.scenes[0]?.nodes ?? [])];
  const meshRoots = roots.filter((idx) => st.nodes[idx]?.mesh !== undefined);
  const boneRoots = roots.filter((idx) => st.nodes[idx]?.mesh === undefined);
  const l0Idx =
    meshRoots.length === 1
      ? meshRoots[0]!
      : st.nodes.push({
          name: `${sourceDocument.id}_LOD0`,
          ...(meshRoots.length > 0 ? { children: meshRoots } : {}),
        }) - 1;
  const prev = st.nodes[l0Idx]!;
  st.nodes[l0Idx] = {
    ...prev,
    name: `${sourceDocument.id}_LOD0`,
    extensions: { ...(prev.extensions ?? {}), MSFT_lod: { ids: [l1Idx, l2Idx] } },
    extras: {
      ...(prev.extras ?? {}),
      MSFT_screencoverage: [0.5, 0.2, 0.05],
      ashfox: { lod: meta },
    },
  };
  return finalize(compiled, st, [...boneRoots, l0Idx, l1Idx, l2Idx]);
};
