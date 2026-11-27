import type { StructureProduct } from '../../../compiler/structure/contract';
import type { ProjectDocument } from '../../../model';
import type { CompiledModel } from '../../../model/compiled';
import type { TextureAsset } from '../../../model/texture';
import { compiledModelToProjectDocument } from '../../../project/create';
import { effectivelyVisibleSceneNodeIds } from '../../../sceneVisibility';
import { compareText } from '../../../stableOrder';
import { compileOpaqueCubeFaceOcclusion } from '../../occlusion/cube';
import type { GltfBinaryWriter } from './binary';
import type { GltfMesh, GltfNode } from './contract';
import type { GltfPrimitiveData } from './data';
import { compileQuantizedGltfPrimitive } from './primitive';
import { buildPropNode } from './propNode';
import {
  appendNumbers,
  gltfNodeGeometryRotation,
  primitiveDataForGltfNode,
  transformPrimitiveByWorldMat4,
} from './rigid';
import { computeWorldMatrices, restTranslation } from './scene';
import { getMaterialIndex, type MaterialRegistry } from './structureMat';
import { computePositionsBounds, type PositionBounds } from './vertexLayout';

const GLTF_UNIT_SCALE = 1 / 16;

export interface StructurePropContext {
  readonly textures: Readonly<Record<string, TextureAsset>>;
  readonly matReg: MaterialRegistry;
  readonly writer: GltfBinaryWriter;
}

interface TexMeta {
  readonly tex: TextureAsset;
  readonly masked: boolean;
}

type TaggedPrimitive = GltfPrimitiveData & { readonly texMeta?: TexMeta };

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

const buildCustomMaterialMaps = (
  texRemap: ReadonlyMap<string, string>,
  ctx: StructurePropContext,
) => {
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
  ctx: StructurePropContext,
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
    if (node.kind === 'bone' || node.kind === 'locator') continue;
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
  ctx: StructurePropContext,
): { readonly mesh: GltfMesh; readonly bounds: PositionBounds } => {
  const doc = compiledModelToProjectDocument(model, {
    id: assetKey,
    name: assetKey,
    revision: 'prop-1',
    copyTextures: true,
  });
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

/** Bakes and instances custom structure prop models into glTF meshes and nodes. */
export const appendCustomInstances = (
  product: StructureProduct,
  modelTexRemap: ReadonlyMap<CompiledModel, ReadonlyMap<string, string>>,
  ctx: StructurePropContext,
  meshes: GltfMesh[],
  nodes: GltfNode[],
  children: number[],
): {
  readonly customBounds: ReadonlyMap<string, PositionBounds>;
  readonly usesGpuInstancing: boolean;
} => {
  const customBounds = new Map<string, PositionBounds>();
  let usesGpuInstancing = false;
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
    const model = product.customModels[assetKey]!;
    const baked = bakeCustomModelMesh(assetKey, model, modelTexRemap.get(model)!, ctx);
    if (baked.mesh.primitives.length === 0) continue;
    for (const alias of aliases) customBounds.set(alias, baked.bounds);
    const meshIdx = meshes.length;
    meshes.push(baked.mesh);
    children.push(nodes.length);
    const name = group.length >= 2 ? `props_${assetKey}` : `prop_${children.length}`;
    const built = buildPropNode(name, meshIdx, baked.bounds, group, ctx.writer);
    if (built.instanced) usesGpuInstancing = true;
    nodes.push(built.node);
  }
  return { customBounds, usesGpuInstancing };
};
