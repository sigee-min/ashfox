import type { StructureBakedBatch, StructureProduct } from '../../../compiler/structure/contract';
import type { ProjectDocument } from '../../../model';
import type { TextureAsset } from '../../../model/texture';
import { compareText } from '../../../stableOrder';
import { encodeCanonicalPng } from '../../../textures/textureRecipe/png';
import { rasterizeTextureSpec } from '../../../textures/textureRecipe/raster';
import { adaptProjectForExport } from '../../adapter';
import { validateExportTarget } from '../../pipeline/validate';
import { compileGltfAnimations } from './animation';
import { GltfBinaryWriter } from './binary';
import type { CompiledGltf } from './build';
import type { GltfAnimation, GltfDocument, GltfMaterial, GltfNode, GltfSkin } from './contract';
import {
  buildModelLod1Document,
  buildModelLod2Mesh,
  computeModelBoundsAndPartSizes,
} from './modelLod';
import { compileGltfPrimitive } from './primitive';
import { compileGltfScene } from './scene';
import { quaternionFromEuler } from './spatial';

export const DEFAULT_STRUCTURE_LOD_DISTANCES: readonly [number, number, number] = [0, 28, 75];
export const DEFAULT_MODEL_LOD_DISTANCES: readonly [number, number, number] = [0, 18, 45];
export const DEFAULT_LOD_HYSTERESIS = 2.5;
const ATTR_KEYS = ['POSITION', 'NORMAL', 'TEXCOORD_0', 'COLOR_0', 'JOINTS_0', 'WEIGHTS_0'] as const;

export interface AshfoxLodMetadata {
  readonly distances: readonly [number, number, number];
  readonly hysteresis: number;
  readonly boundingSphere: readonly [number, number, number, number];
}
export interface GltfLodNode extends Omit<GltfNode, 'extras'> {
  extensions?: { MSFT_lod?: { ids: number[] } };
  extras?: Partial<NonNullable<GltfNode['extras']>> & {
    MSFT_screencoverage?: number[];
    ashfox?: { lod?: AshfoxLodMetadata };
  };
}
export interface GltfLodDocument extends Omit<GltfDocument, 'extensionsUsed' | 'nodes'> {
  extensionsUsed?: string[];
  nodes: GltfLodNode[];
}
export interface CompiledGltfWithLod {
  readonly document: GltfLodDocument;
  readonly binary: Uint8Array;
  readonly textureFiles: CompiledGltf['textureFiles'];
}
export interface AttachLodOptions {
  readonly distances?: readonly [number, number, number];
  readonly hysteresis?: number;
  readonly quantize?: boolean;
}
type State = {
  writer: GltfBinaryWriter;
  baseMeshes: number;
  aOff: number;
  nodes: GltfLodNode[];
  meshes: NonNullable<GltfDocument['meshes']>;
  images: NonNullable<GltfDocument['images']>;
  samplers: NonNullable<GltfDocument['samplers']>;
  textures: NonNullable<GltfDocument['textures']>;
  materials: GltfMaterial[];
  skins: GltfSkin[];
};

const initState = (c: CompiledGltf, opts: AttachLodOptions): State => {
  const d = c.document;
  const q = opts.quantize ?? d.extensionsUsed?.includes('KHR_mesh_quantization') ?? true;
  return {
    writer: new GltfBinaryWriter(q),
    baseMeshes: d.meshes?.length ?? 0,
    aOff: d.accessors?.length ?? 0,
    nodes: d.nodes.map((n) => ({ ...n })),
    meshes: [...(d.meshes ?? [])],
    images: [...(d.images ?? [])],
    samplers: [...(d.samplers ?? [])],
    textures: [...(d.textures ?? [])],
    materials: [...(d.materials ?? [])],
    skins: [...(d.skins ?? [])],
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

const colorMesh = (
  st: State,
  name: string,
  matName: string,
  p: readonly number[],
  n: readonly number[],
  idx: readonly number[],
  col?: readonly number[],
) => {
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
  const prim = compileGltfPrimitive(
    st.writer,
    p,
    n,
    undefined,
    undefined,
    mid,
    idx,
    undefined,
    col?.length ? col : undefined,
  );
  return st.meshes.push({ name, primitives: [prim] }) - 1;
};

const wrapLods = (
  id: string,
  nodes: GltfLodNode[],
  l0C: readonly number[],
  l1C: readonly number[],
  l2M: number | undefined,
  l1M: number | undefined,
  meta: AshfoxLodMetadata,
) => {
  const l1 =
    nodes.push({
      name: `${id}_LOD1`,
      ...(l1M !== undefined ? { mesh: l1M } : {}),
      ...(l1C.length ? { children: [...l1C] } : {}),
    }) - 1;
  const l2 = nodes.push({ name: `${id}_LOD2`, ...(l2M !== undefined ? { mesh: l2M } : {}) }) - 1;
  const l0 =
    nodes.push({
      name: `${id}_LOD0`,
      ...(l0C.length ? { children: [...l0C] } : {}),
      extensions: { MSFT_lod: { ids: [l1, l2] } },
      extras: { MSFT_screencoverage: [0.5, 0.2, 0.05] },
    }) - 1;
  return nodes.push({ name: id, children: [l0, l1, l2], extras: { ashfox: { lod: meta } } }) - 1;
};

const shiftMeshAccessors = (st: State) => {
  if (st.aOff === 0) return;
  for (let i = st.baseMeshes; i < st.meshes.length; i += 1) {
    for (const p of st.meshes[i]!.primitives) {
      if (p.indices !== undefined) p.indices += st.aOff;
      for (const k of ATTR_KEYS) if (p.attributes[k] !== undefined) p.attributes[k]! += st.aOff;
    }
  }
};

const finalize = (
  c: CompiledGltf,
  st: State,
  wrapperIdx: number,
  animations?: GltfAnimation[],
): CompiledGltfWithLod => {
  shiftMeshAccessors(st);
  const [baseLen, tail] = [(c.binary.byteLength + 3) & ~3, st.writer.toUint8Array()];
  const binary = new Uint8Array(baseLen + tail.byteLength);
  binary.set(c.binary, 0);
  binary.set(tail, baseLen);
  const bv = c.document.bufferViews ?? [];
  const used = new Set([...(c.document.extensionsUsed ?? []), 'MSFT_lod']);
  const req = new Set(c.document.extensionsRequired ?? []);
  if (st.writer.state.usesMeshQuantization)
    [used.add('KHR_mesh_quantization'), req.add('KHR_mesh_quantization')];
  const newBv = st.writer.state.bufferViews.map((v) => ({
    ...v,
    byteOffset: v.byteOffset + baseLen,
  }));
  const newAcc = st.writer.state.accessors.map((a) => ({
    ...a,
    bufferView: a.bufferView + bv.length,
  }));
  const doc: GltfLodDocument = {
    ...c.document,
    extensionsUsed: [...used],
    scenes: [{ ...(c.document.scenes[0] ?? {}), nodes: [wrapperIdx] }],
    nodes: st.nodes,
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews: [...bv, ...newBv],
    accessors: [...(c.document.accessors ?? []), ...newAcc],
    meshes: st.meshes,
  };
  if (req.size) doc.extensionsRequired = [...req];
  if (st.images.length)
    Object.assign(doc, { images: st.images, samplers: st.samplers, textures: st.textures });
  if (st.materials.length) doc.materials = st.materials;
  if (st.skins.length) doc.skins = st.skins;
  if (animations?.length) doc.animations = animations;
  return { document: doc, binary, textureFiles: c.textureFiles };
};

const resolveMat = (
  st: State,
  tex: TextureAsset | undefined,
  layer: StructureBakedBatch['layer'],
  mats: Map<string, number>,
) => {
  if (!tex) return undefined;
  const [key, hit] = [`${tex.name}:${layer}`, mats.get(`${tex.name}:${layer}`)];
  if (hit !== undefined || !tex.raster) return hit;
  const png = encodeCanonicalPng(rasterizeTextureSpec(tex.width, tex.height, tex.raster));
  const img =
    st.images.push({
      bufferView: st.writer.addBufferView(png),
      mimeType: 'image/png',
      name: tex.name,
    }) - 1;
  const f = tex.sampling === 'nearest' ? 9728 : 9729;
  const samp = st.samplers.push({ magFilter: f, minFilter: f, wrapS: 10497, wrapT: 10497 }) - 1;
  const tid = st.textures.push({ sampler: samp, source: img, name: tex.name }) - 1;
  const mat: GltfMaterial = {
    name: tex.name,
    pbrMetallicRoughness: {
      baseColorTexture: { index: tid },
      metallicFactor: 0,
      roughnessFactor: 1,
    },
  };
  if (layer === 'emissive' || tex.renderMode === 'emissive')
    [mat.emissiveTexture, mat.emissiveFactor] = [{ index: tid }, [1, 1, 1]];
  if (layer === 'cutout') [mat.alphaMode, mat.alphaCutoff, mat.doubleSided] = ['MASK', 0.5, true];
  const mid = st.materials.push(mat) - 1;
  mats.set(key, mid);
  return mid;
};

const buildStructLod1 = (product: StructureProduct, st: State): number | undefined => {
  const lod1 = product.lodLevels?.lod1;
  const active = lod1?.batches.filter((b) => b.indices.length > 0 && b.positions.length > 0) ?? [];
  if (!lod1 || active.length === 0) return undefined;
  const mats = new Map<string, number>();
  st.materials.forEach(
    (m, i) =>
      m.name &&
      mats.set(
        `${m.name}:${m.alphaMode === 'MASK' ? 'cutout' : m.emissiveTexture ? 'emissive' : 'opaque'}`,
        i,
      ),
  );
  const prims = active.map((b) =>
    compileGltfPrimitive(
      st.writer,
      b.positions,
      b.normals,
      b.uvs.length ? b.uvs : undefined,
      undefined,
      resolveMat(st, lod1.textures[b.textureId], b.layer, mats),
      b.indices,
      undefined,
      b.colors.length ? b.colors : undefined,
    ),
  );
  return st.meshes.push({ name: `${product.id}_lod1`, primitives: prims }) - 1;
};

export const attachStructureLods = (
  compiled: CompiledGltf,
  product: StructureProduct,
  options: AttachLodOptions = {},
): CompiledGltfWithLod => {
  const lods = product.lodLevels;
  if (!lods)
    return {
      document: { ...compiled.document, nodes: compiled.document.nodes.map((n) => ({ ...n })) },
      binary: compiled.binary,
      textureFiles: compiled.textureFiles,
    };
  const st = initState(compiled, options);
  const byKey = new Map<string, number>();
  st.meshes.forEach((m, i) => m.name && byKey.set(m.name, i));
  const props: number[] = [];
  for (const inst of lods.lod1.instances) {
    const mesh = byKey.get(inst.assetKey);
    if (mesh !== undefined)
      props.push(
        st.nodes.push({
          name: `lod1_prop_${props.length + 1}`,
          mesh,
          translation: [...inst.translation],
          ...(inst.rotation ? { rotation: quaternionFromEuler([0, inst.rotation, 0]) } : {}),
        }) - 1,
      );
  }
  const b2 = lods.lod2.batches.find((b) => b.indices.length > 0 && b.positions.length > 0);
  const l2M = b2
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
  return finalize(
    compiled,
    st,
    wrapLods(
      product.id,
      st.nodes,
      compiled.document.scenes[0]?.nodes ?? [0],
      props,
      l2M,
      buildStructLod1(product, st),
      meta,
    ),
  );
};

const mergeAnims = (
  base: readonly GltfAnimation[],
  add: readonly GltfAnimation[],
  nOff: number,
  aOff: number,
): GltfAnimation[] => {
  const out = base.map((a) => ({ ...a, samplers: [...a.samplers], channels: [...a.channels] }));
  const byName = new Map(out.filter((a) => a.name).map((a) => [a.name!, a]));
  for (const a of add) {
    const tgt = a.name ? byName.get(a.name) : undefined;
    const sBase = tgt ? tgt.samplers.length : 0;
    const samplers = a.samplers.map((s) => ({
      ...s,
      input: s.input + aOff,
      output: s.output + aOff,
    }));
    const channels = a.channels.map((c) => ({
      sampler: c.sampler + sBase,
      target: { node: c.target.node + nOff, path: c.target.path },
    }));
    if (tgt) [tgt.samplers.push(...samplers), tgt.channels.push(...channels)];
    else out.push({ ...a, samplers, channels });
  }
  return out;
};

const appendSceneNodes = (st: State, l1: ReturnType<typeof compileGltfScene>) => {
  const [nOff, mOff, sOff] = [st.nodes.length, st.meshes.length, st.skins.length];
  for (const n of l1.nodes) {
    const c: GltfLodNode = { ...n };
    if (c.mesh !== undefined) c.mesh += mOff;
    if (c.skin !== undefined) c.skin += sOff;
    if (c.children) c.children = c.children.map((x) => x + nOff);
    st.nodes.push(c);
  }
  st.meshes.push(...l1.meshes);
  for (const s of l1.skins) {
    const c: GltfSkin = { ...s, joints: s.joints.map((j) => j + nOff) };
    if (c.inverseBindMatrices !== undefined) c.inverseBindMatrices += st.aOff;
    if (c.skeleton !== undefined) c.skeleton += nOff;
    st.skins.push(c);
  }
  return nOff;
};

const appendLod1Model = (doc: ProjectDocument, st: State) => {
  const [matMap, ssMap] = [new Map<string, number>(), new Map<string, number>()];
  for (const t of Object.values(doc.textures).sort((a, b) => compareText(a.id, b.id))) {
    const i = st.materials.findIndex((m) => m.name === t.name);
    const s = st.materials.findIndex((m) => m.name === `${t.name} (front-sided)`);
    if (i >= 0) matMap.set(t.id, i);
    if (s >= 0) ssMap.set(t.id, s);
  }
  const lod1Doc = buildModelLod1Document(doc);
  const l1 = compileGltfScene(lod1Doc, {
    writer: st.writer,
    materialByTextureId: matMap,
    singleSidedMaterialByTextureId: ssMap,
    unitScale: 1 / 16,
  });
  let anims: GltfAnimation[] = [];
  if (Object.keys(lod1Doc.animations).length > 0) {
    const val = validateExportTarget(
      adaptProjectForExport(lod1Doc, { target: 'gltf', modelPath: 'lod1' }),
      { profileId: 'gltf.2', errorMessage: 'LOD1 animation validation failed.' },
    );
    anims = compileGltfAnimations(val.document, { ...l1, writer: st.writer, unitScale: 1 / 16 });
  }
  const nOff = appendSceneNodes(st, l1);
  return { roots: l1.rootNodeIndices.map((i) => i + nOff), anims, nOff };
};

export const attachModelLods = (
  compiled: CompiledGltf,
  sourceDocument: ProjectDocument,
  options: AttachLodOptions = {},
): CompiledGltfWithLod => {
  const st = initState(compiled, options);
  const [l1, l2] = [appendLod1Model(sourceDocument, st), buildModelLod2Mesh(sourceDocument)];
  const l2M = colorMesh(
    st,
    `${sourceDocument.id}_lod2`,
    `${sourceDocument.id}_lod2_proxy`,
    l2.positions,
    l2.normals,
    l2.indices,
    l2.colors,
  );
  const meta = buildLodDocumentMetadata(
    options.distances ?? DEFAULT_MODEL_LOD_DISTANCES,
    computeModelBoundsAndPartSizes(sourceDocument).boundingSphere,
    options.hysteresis,
  );
  const wrap = wrapLods(
    sourceDocument.id,
    st.nodes,
    compiled.document.scenes[0]?.nodes ?? [0],
    l1.roots,
    l2M,
    undefined,
    meta,
  );
  return finalize(
    compiled,
    st,
    wrap,
    mergeAnims(compiled.document.animations ?? [], l1.anims, l1.nOff, st.aOff),
  );
};
