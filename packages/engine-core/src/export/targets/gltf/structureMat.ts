import type { StructureProduct } from '../../../compiler/structure/contract';
import type { CompiledModel } from '../../../model/compiled';
import type { TextureAsset } from '../../../model/texture';
import type { GltfMaterial } from './contract';
import { createGltfMaterial } from './material';
import type { UvTransform } from './vertexLayout';

export interface MaterialRegistry {
  readonly materials: GltfMaterial[];
  readonly texIndexById: ReadonlyMap<string, number>;
  readonly mrTexIndexById: ReadonlyMap<string, number>;
  readonly cache: Map<string, number>;
  usesTextureTransform: boolean;
  usesUnlit: boolean;
}

export type StructureMaterialMode =
  StructureProduct['bakedMesh']['batches'][number]['layer'] | 'model';

const applyModeOverrides = (mat: GltfMaterial, mode: StructureMaterialMode): void => {
  if (mode === 'translucent' || mode === 'sun_shaft') {
    mat.alphaMode = 'BLEND';
    mat.pbrMetallicRoughness.baseColorFactor = [1, 1, 1, mode === 'sun_shaft' ? 0.35 : 0.45];
  }
  if (mode === 'sun_shaft') {
    mat.extensions = { KHR_materials_unlit: {} };
    mat.extras = { ashfoxBlendMode: 'additive' };
  }
};

/** Creates a deduplicated glTF material registry backed by encoded texture indices. */
export const createMaterialRegistry = (
  texIndexById: ReadonlyMap<string, number>,
  mrTexIndexById: ReadonlyMap<string, number>,
): MaterialRegistry => ({
  materials: [],
  texIndexById,
  mrTexIndexById,
  cache: new Map(),
  usesTextureTransform: false,
  usesUnlit: false,
});

/** Resolves or allocates a cached glTF material index for a texture and structure layer mode. */
export const getMaterialIndex = (
  reg: MaterialRegistry,
  tex: TextureAsset,
  mode: StructureMaterialMode,
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
    tex.name,
    reg.mrTexIndexById.get(tex.id),
  );
  applyModeOverrides(mat, mode);
  reg.materials.push(mat);
  reg.cache.set(key, idx);
  return idx;
};

/** Collects baked structure textures and remaps custom prop textures into unique material IDs. */
export const collectUsedTextures = (product: StructureProduct) => {
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
