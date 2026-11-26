import type { StructureProduct } from '../../../compiler/structure/contract';
import type { CompiledModel } from '../../../model/compiled';
import { sealCanonicalBoneFrame, type ProjectDocument } from '../../../model';
import type { TextureAsset } from '../../../model/texture';
import { createProjectDocument } from '../../../project/create';
import { effectivelyVisibleSceneNodeIds } from '../../../sceneVisibility';
import { compareText } from '../../../stableOrder';
import { encodeCanonicalPng } from '../../../textures/textureRecipe/png';
import { rasterizeTextureSpec } from '../../../textures/textureRecipe/raster';
import { compileOpaqueCubeFaceOcclusion } from '../../occlusion/cube';
import { GltfBinaryWriter } from './binary';
import type { CompiledGltf } from './build';
import type {
  GltfDocument,
  GltfExtensionName,
  GltfImage,
  GltfMaterial,
  GltfMesh,
  GltfNode,
  GltfSampler,
} from './contract';
import type { GltfPrimitiveData } from './data';
import { createGltfMaterial } from './exporter';
import { appendHooksToGltfDocument } from './hooksEmit';
import { attachStructureLods } from './lodEmit';
import { compileQuantizedGltfPrimitive } from './primitive';
import { buildPropNode } from './propNode';
import {
  appendNumbers,
  gltfNodeGeometryRotation,
  primitiveDataForGltfNode,
  transformPrimitiveByWorldMat4,
} from './rigid';
import { computeWorldMatrices, restTranslation } from './scene';
import { computePositionsBounds, type PositionBounds, type UvTransform } from './vertexLayout';

const GLTF_UNIT_SCALE = 1 / 16;

interface MaterialRegistry {
  readonly materials: GltfMaterial[];
  readonly texIndexById: ReadonlyMap<string, number>;
  readonly cache: Map<string, number>;
  usesTextureTransform: boolean;
  usesUnlit: boolean;
}

interface GltfBuildCtx {
  readonly textures: Readonly<Record<string, TextureAsset>>;
  readonly matReg: MaterialRegistry;
  readonly writer: GltfBinaryWriter;
  usesGpuInstancing: boolean;
}

interface TexMeta {
  readonly tex: TextureAsset;
  readonly masked: boolean;
}

type TaggedPrimitive = GltfPrimitiveData & { readonly texMeta?: TexMeta };

const applyModeOverrides = (
  mat: GltfMaterial,
  mode: StructureProduct['bakedMesh']['batches'][number]['layer'] | 'model',
): void => {
  if (mode === 'translucent' || mode === 'sun_shaft') {
    mat.alphaMode = 'BLEND';
    mat.pbrMetallicRoughness.baseColorFactor = [1, 1, 1, mode === 'sun_shaft' ? 0.35 : 0.45];
  }
  if (mode === 'sun_shaft') {
    mat.extensions = { KHR_materials_unlit: {} };
    mat.extras = { ashfoxBlendMode: 'additive' };
  }
};

const getMaterialIndex = (
  reg: MaterialRegistry,
  tex: TextureAsset,
  mode: StructureProduct['bakedMesh']['batches'][number]['layer'] | 'model',
  masked = false,
  uvTransform?: UvTransform,
): number => {
  const isCutout = mode === 'cutout' || masked;
  const isEmissive = mode === 'emissive' || tex.renderMode === 'emissive';
  const doubleSided =
    isCutout || mode === 'translucent' || mode === 'sun_shaft' || tex.renderSides === 'double';
  const uvKey = uvTransform
    ? `:uv(${uvTransform.offset[0]},${uvTransform.offset[1]},${uvTransform.scale[0]},${uvTransform.scale[1]})`
    : '';
  const key = `${tex.id}:${mode}:${isCutout ? 'M' : isEmissive ? 'E' : tex.renderMode}:${doubleSided ? 'D' : 'S'}${uvKey}`;
  const hit = reg.cache.get(key);
  if (hit !== undefined) return hit;
  if (uvTransform) reg.usesTextureTransform = true;
  if (mode === 'sun_shaft') reg.usesUnlit = true;
  const idx = reg.materials.length;
  const mat = createGltfMaterial(
    tex,
    reg.texIndexById.get(tex.id)!,
    isCutout,
    doubleSided,
    isEmissive,
    uvTransform,
  );
  applyModeOverrides(mat, mode);
  reg.materials.push(mat);
  reg.cache.set(key, idx);
  return idx;
};

const modelStubDocument = (id: string, model: CompiledModel): ProjectDocument => {
  const doc = createProjectDocument({
    id,
    name: id,
    revision: 'prop-1',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  for (const node of Object.values(model.scene.nodes)) {
    if (node.kind === 'bone') sealCanonicalBoneFrame(node);
  }
  doc.scene = model.scene;
  doc.textures = { ...model.textures };
  return doc;
};

const collectUsedTextures = (product: StructureProduct) => {
  const textures: Record<string, TextureAsset> = {};
  for (const batch of product.bakedMesh.batches) {
    const tex = product.bakedMesh.textures[batch.textureId];
    if (tex) textures[tex.id] = tex;
  }
  const modelTexRemap = new Map<CompiledModel, ReadonlyMap<string, string>>();
  let modelSeq = 0;
  for (const inst of product.bakedMesh.instances) {
    const model = product.customModels[inst.assetKey];
    if (!model || modelTexRemap.has(model)) continue;
    const prefix = `cm_${modelSeq++}`;
    const remap = new Map<string, string>();
    for (const [tid, tex] of Object.entries(model.textures)) {
      const id = `${prefix}_${tid}`;
      remap.set(tid, id);
      textures[id] = { ...tex, id, name: id };
    }
    modelTexRemap.set(model, remap);
  }
  return { textures, modelTexRemap };
};

const mergeMaterialGroup = (matKey: number, list: readonly TaggedPrimitive[]) => {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const hasUvs = list.every((p) => p.uvs !== undefined);
  for (const p of list) {
    const base = positions.length / 3;
    appendNumbers(positions, p.positions);
    appendNumbers(normals, p.normals);
    if (hasUvs && p.uvs) appendNumbers(uvs, p.uvs);
    for (let i = 0; i < p.indices.length; i += 1) indices.push(base + p.indices[i]!);
  }
  return {
    material: matKey >= 0 ? matKey : undefined,
    texMeta: list[0]?.texMeta,
    positions,
    normals,
    uvs: hasUvs ? uvs : undefined,
    indices,
  };
};

const mergeCustomByMaterial = (prims: readonly TaggedPrimitive[]) => {
  const byMat = new Map<number, TaggedPrimitive[]>();
  for (const p of prims) {
    const key = p.material ?? -1;
    const list = byMat.get(key) ?? [];
    list.push(p);
    byMat.set(key, list);
  }
  return [...byMat.entries()]
    .sort(([a], [b]) => a - b)
    .map(([matKey, list]) => mergeMaterialGroup(matKey, list));
};

const buildCustomMaterialMaps = (texRemap: ReadonlyMap<string, string>, ctx: GltfBuildCtx) => {
  const materialByTextureId = new Map<string, number>();
  const singleSidedMaterialByTextureId = new Map<string, number>();
  const texMetaByMat = new Map<number, TexMeta>();
  for (const [origId, remappedId] of texRemap) {
    const tex = ctx.textures[remappedId];
    if (!tex) continue;
    const matIdx = getMaterialIndex(ctx.matReg, tex, 'model', false);
    materialByTextureId.set(origId, matIdx);
    texMetaByMat.set(matIdx, { tex, masked: false });
    if (tex.renderSides === 'double') {
      const ssIdx = getMaterialIndex(ctx.matReg, tex, 'model', true);
      singleSidedMaterialByTextureId.set(origId, ssIdx);
      texMetaByMat.set(ssIdx, { tex, masked: true });
    }
  }
  return { materialByTextureId, singleSidedMaterialByTextureId, texMetaByMat };
};

const collectCustomModelPrimitives = (
  doc: ProjectDocument,
  texRemap: ReadonlyMap<string, string>,
  ctx: GltfBuildCtx,
): TaggedPrimitive[] => {
  const visible = effectivelyVisibleSceneNodeIds(doc);
  const orderedNodes = Object.values(doc.scene.nodes)
    .filter((n) => visible.has(n.id))
    .sort((a, b) => compareText(a.id, b.id));
  const tMap = new Map<string, [number, number, number]>();
  const rMap = new Map<string, [number, number, number]>();
  const sMap = new Map<string, [number, number, number]>();
  for (const n of orderedNodes) {
    tMap.set(n.id, restTranslation(doc, n, GLTF_UNIT_SCALE));
    rMap.set(n.id, [...gltfNodeGeometryRotation(n)]);
    sMap.set(n.id, [...n.transform.scale]);
  }
  const worldMap = computeWorldMatrices(orderedNodes, tMap, rMap, sMap);
  const { texMetaByMat, ...maps } = buildCustomMaterialMaps(texRemap, ctx);
  const opts = {
    writer: ctx.writer,
    ...maps,
    unitScale: GLTF_UNIT_SCALE,
    cubeFaceOcclusion: compileOpaqueCubeFaceOcclusion(doc),
  };
  const collected: TaggedPrimitive[] = [];
  for (const node of orderedNodes) {
    if (node.kind !== 'cube' && node.kind !== 'plane') continue;
    const world = worldMap.get(node.id)!;
    for (const p of primitiveDataForGltfNode(doc, node, opts)) {
      const xf = transformPrimitiveByWorldMat4(p, world, null);
      const texMeta = p.material === undefined ? undefined : texMetaByMat.get(p.material);
      collected.push({ ...xf, ...(texMeta ? { texMeta } : {}) });
    }
  }
  return collected;
};

const bakeCustomModelMesh = (
  assetKey: string,
  model: CompiledModel,
  texRemap: ReadonlyMap<string, string>,
  ctx: GltfBuildCtx,
): { readonly mesh: GltfMesh; readonly bounds: PositionBounds } => {
  const doc = modelStubDocument(assetKey, model);
  const groups = mergeCustomByMaterial(collectCustomModelPrimitives(doc, texRemap, ctx));
  const bounds = computePositionsBounds(groups.map((g) => g.positions));
  const primitives = groups.map((g) =>
    compileQuantizedGltfPrimitive(
      ctx.writer,
      g.positions,
      g.normals,
      g.uvs,
      g.indices,
      bounds,
      (uvTx) =>
        uvTx && g.texMeta
          ? getMaterialIndex(ctx.matReg, g.texMeta.tex, 'model', g.texMeta.masked, uvTx)
          : g.material,
    ),
  );
  return { mesh: { name: assetKey, primitives }, bounds };
};

const compileBakedVoxelMesh = (
  product: StructureProduct,
  ctx: GltfBuildCtx,
): { readonly mesh: GltfMesh; readonly bounds: PositionBounds } | null => {
  const active = product.bakedMesh.batches.filter(
    (b) => b.indices.length > 0 && b.positions.length > 0,
  );
  if (active.length === 0) return null;
  const bounds = computePositionsBounds(active.map((b) => b.positions));
  const primitives = active.map((batch) => {
    const tex = ctx.textures[batch.textureId];
    return compileQuantizedGltfPrimitive(
      ctx.writer,
      batch.positions,
      batch.normals,
      batch.uvs,
      batch.indices,
      bounds,
      (uvTx) => (tex ? getMaterialIndex(ctx.matReg, tex, batch.layer, false, uvTx) : undefined),
      batch.colors.length > 0 ? batch.colors : undefined,
    );
  });
  return { mesh: { name: `${product.id}_voxels`, primitives }, bounds };
};

export interface BuiltStructureGltf {
  readonly compiled: CompiledGltf;
  readonly textures: Readonly<Record<string, TextureAsset>>;
}

const encodeGltfTextures = (ordered: readonly TextureAsset[], writer: GltfBinaryWriter) => {
  const images: GltfImage[] = [];
  const samplers: GltfSampler[] = [];
  const texIndexById = new Map<string, number>();
  ordered.forEach((tex, idx) => {
    texIndexById.set(tex.id, idx);
    const png = encodeCanonicalPng(rasterizeTextureSpec(tex.width, tex.height, tex.raster!));
    images.push({ bufferView: writer.addBufferView(png), mimeType: 'image/png', name: tex.name });
    const filter = tex.sampling === 'nearest' ? 9728 : 9729;
    samplers.push({ magFilter: filter, minFilter: filter, wrapS: 10497, wrapT: 10497 });
  });
  return { images, samplers, texIndexById };
};

const appendCustomInstances = (
  product: StructureProduct,
  modelTexRemap: ReadonlyMap<CompiledModel, ReadonlyMap<string, string>>,
  ctx: GltfBuildCtx,
  meshes: GltfMesh[],
  nodes: GltfNode[],
  children: number[],
): ReadonlyMap<string, PositionBounds> => {
  const customBounds = new Map<string, PositionBounds>();
  const byModel = new Map<
    CompiledModel,
    {
      readonly assetKey: string;
      readonly aliases: Set<string>;
      readonly group: StructureProduct['bakedMesh']['instances'][number][];
    }
  >();
  for (const inst of product.bakedMesh.instances) {
    const model = product.customModels[inst.assetKey];
    if (!model) continue;
    let entry = byModel.get(model);
    if (!entry) {
      entry = { assetKey: inst.assetKey, aliases: new Set(), group: [] };
      byModel.set(model, entry);
    }
    entry.aliases.add(inst.assetKey);
    entry.group.push(inst);
  }
  for (const [, { assetKey, aliases, group }] of byModel) {
    const baked = bakeCustomModelMesh(
      assetKey,
      product.customModels[assetKey]!,
      modelTexRemap.get(product.customModels[assetKey]!)!,
      ctx,
    );
    if (baked.mesh.primitives.length === 0) continue;
    for (const alias of aliases) customBounds.set(alias, baked.bounds);
    const meshIdx = meshes.length;
    meshes.push(baked.mesh);
    children.push(nodes.length);
    const name = group.length >= 2 ? `props_${assetKey}` : `prop_${children.length}`;
    const built = buildPropNode(name, meshIdx, baked.bounds, group, ctx.writer);
    if (built.instanced) ctx.usesGpuInstancing = true;
    nodes.push(built.node);
  }
  return customBounds;
};

const collectStructureExtensions = (ctx: GltfBuildCtx) => {
  const used: GltfExtensionName[] = [];
  const required: GltfExtensionName[] = [];
  if (ctx.writer.state.usesMeshQuantization) {
    used.push('KHR_mesh_quantization');
    required.push('KHR_mesh_quantization');
  }
  if (ctx.matReg.usesTextureTransform) used.push('KHR_texture_transform');
  if (ctx.matReg.usesUnlit) used.push('KHR_materials_unlit');
  if (ctx.usesGpuInstancing) used.push('EXT_mesh_gpu_instancing');
  return {
    ...(used.length > 0 ? { extensionsUsed: used } : {}),
    ...(required.length > 0 ? { extensionsRequired: required } : {}),
  };
};

const assembleStructureGltfDocument = (
  id: string,
  ctx: GltfBuildCtx,
  binary: Uint8Array,
  nodes: GltfNode[],
  meshes: GltfMesh[],
  ordered: readonly TextureAsset[],
  images: GltfImage[],
  samplers: GltfSampler[],
): GltfDocument => ({
  asset: { version: '2.0', generator: 'ashfox engine core' },
  ...collectStructureExtensions(ctx),
  scene: 0,
  scenes: [{ name: id, nodes: [0] }],
  nodes,
  ...(binary.byteLength > 0
    ? {
        buffers: [{ byteLength: binary.byteLength }],
        bufferViews: ctx.writer.state.bufferViews,
        accessors: ctx.writer.state.accessors,
      }
    : {}),
  ...(meshes.length > 0 ? { meshes } : {}),
  ...(ordered.length > 0
    ? {
        images,
        samplers,
        textures: ordered.map((t, i) => ({ sampler: i, source: i, name: t.name })),
        materials: ctx.matReg.materials,
      }
    : {}),
});

const createGltfBuildCtx = (
  textures: Readonly<Record<string, TextureAsset>>,
  texIndexById: ReadonlyMap<string, number>,
  writer: GltfBinaryWriter,
): GltfBuildCtx => ({
  textures,
  matReg: {
    materials: [],
    texIndexById,
    cache: new Map(),
    usesTextureTransform: false,
    usesUnlit: false,
  },
  writer,
  usesGpuInstancing: false,
});

export const buildStructureGltf = (
  product: StructureProduct,
  options: { readonly quantize?: boolean; readonly includeLods?: boolean } = {},
): BuiltStructureGltf => {
  const writer = new GltfBinaryWriter(options.quantize ?? true);
  const { textures, modelTexRemap } = collectUsedTextures(product);
  const ordered = Object.values(textures).sort((a, b) => compareText(a.id, b.id));
  const { images, samplers, texIndexById } = encodeGltfTextures(ordered, writer);
  const ctx = createGltfBuildCtx(textures, texIndexById, writer);
  const meshes: GltfMesh[] = [];
  const nodes: GltfNode[] = [{ name: product.id }];
  const children: number[] = [];
  const voxel = compileBakedVoxelMesh(product, ctx);
  if (voxel) {
    meshes.push(voxel.mesh);
    children.push(nodes.length);
    nodes.push({
      name: `${product.id}_mesh`,
      mesh: 0,
      ...(writer.isQuantized
        ? { translation: [...voxel.bounds.center], scale: [...voxel.bounds.halfExtent] }
        : {}),
    });
  }
  const customBounds = appendCustomInstances(product, modelTexRemap, ctx, meshes, nodes, children);
  if (children.length > 0) nodes[0]!.children = children;
  const binary = writer.toUint8Array();
  const document = assembleStructureGltfDocument(
    product.id,
    ctx,
    binary,
    nodes,
    meshes,
    ordered,
    images,
    samplers,
  );
  const base: CompiledGltf = { document, binary, textureFiles: [] };
  const withLod =
    options.includeLods !== false && product.lodLevels
      ? attachStructureLods(base, product, { quantize: writer.isQuantized, customBounds })
      : base;
  const [w, _h, d] = product.grid.size;
  const compiled: CompiledGltf = {
    ...withLod,
    document: appendHooksToGltfDocument(withLod.document, product.hooks, {
      unitScale: 1,
      offset: [-w / 2, 0, -d / 2],
    }),
  };
  return { compiled, textures };
};
