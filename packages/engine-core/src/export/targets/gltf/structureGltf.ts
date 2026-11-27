import type { StructureProduct } from '../../../compiler/structure/contract';
import type { TextureAsset } from '../../../model/texture';
import { compareText } from '../../../stableOrder';
import { GltfBinaryWriter } from './binary';
import type { CompiledGltf } from './build';
import type {
  GltfDocument,
  GltfExtensionName,
  GltfImage,
  GltfMesh,
  GltfNode,
  GltfSampler,
  GltfTexture,
} from './contract';
import { appendHooksToGltfDocument } from './hooksEmit';
import { attachStructureLods } from './lodEmit';
import { encodeOrderedGltfTextures as encodeGltfTextures } from './lodMat';
import { compileQuantizedGltfPrimitive } from './primitive';
import {
  collectUsedTextures,
  createMaterialRegistry,
  getMaterialIndex,
  type MaterialRegistry,
} from './structureMat';
import { appendCustomInstances } from './structureProps';
import { computePositionsBounds, type PositionBounds } from './vertexLayout';

interface GltfBuildCtx {
  readonly textures: Readonly<Record<string, TextureAsset>>;
  readonly matReg: MaterialRegistry;
  readonly writer: GltfBinaryWriter;
  usesGpuInstancing: boolean;
}

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
  gltfTextures: GltfTexture[],
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
        textures: gltfTextures,
        materials: ctx.matReg.materials,
      }
    : {}),
});

const createGltfBuildCtx = (
  textures: Readonly<Record<string, TextureAsset>>,
  texIndexById: ReadonlyMap<string, number>,
  mrTexIndexById: ReadonlyMap<string, number>,
  writer: GltfBinaryWriter,
): GltfBuildCtx => ({
  textures,
  matReg: createMaterialRegistry(texIndexById, mrTexIndexById),
  writer,
  usesGpuInstancing: false,
});

const finalizeBuiltStructureGltf = (
  product: StructureProduct,
  ctx: GltfBuildCtx,
  nodes: GltfNode[],
  meshes: GltfMesh[],
  ordered: readonly TextureAsset[],
  images: GltfImage[],
  samplers: GltfSampler[],
  gltfTextures: GltfTexture[],
  customBounds: ReadonlyMap<string, PositionBounds>,
  includeLods: boolean,
): CompiledGltf => {
  const document = assembleStructureGltfDocument(
    product.id,
    ctx,
    ctx.writer.toUint8Array(),
    nodes,
    meshes,
    ordered,
    images,
    samplers,
    gltfTextures,
  );
  const base: CompiledGltf = { document, binary: ctx.writer.toUint8Array(), textureFiles: [] };
  const withLod =
    includeLods && product.lodLevels
      ? attachStructureLods(base, product, { quantize: ctx.writer.isQuantized, customBounds })
      : base;
  const [w, _h, d] = product.grid.size;
  return {
    ...withLod,
    document: appendHooksToGltfDocument(withLod.document, product.hooks, {
      unitScale: 1,
      offset: [-w / 2, 0, -d / 2],
    }),
  };
};

/** Builds a glTF document, binary buffer, and texture map for a compiled structure product. */
export const buildStructureGltf = (
  product: StructureProduct,
  options: { readonly quantize?: boolean; readonly includeLods?: boolean } = {},
): BuiltStructureGltf => {
  const writer = new GltfBinaryWriter(options.quantize ?? true);
  const { textures, modelTexRemap } = collectUsedTextures(product);
  const ordered = Object.values(textures).sort((a, b) => compareText(a.id, b.id));
  const { images, samplers, gltfTextures, texIndexById, mrTexIndexById } = encodeGltfTextures(
    ordered,
    writer,
  );
  const ctx = createGltfBuildCtx(textures, texIndexById, mrTexIndexById, writer);
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
  const props = appendCustomInstances(product, modelTexRemap, ctx, meshes, nodes, children);
  ctx.usesGpuInstancing = props.usesGpuInstancing;
  if (children.length > 0) nodes[0]!.children = children;
  const compiled = finalizeBuiltStructureGltf(
    product,
    ctx,
    nodes,
    meshes,
    ordered,
    images,
    samplers,
    gltfTextures,
    props.customBounds,
    options.includeLods !== false,
  );
  return { compiled, textures };
};
