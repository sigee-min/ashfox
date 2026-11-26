import type { StructureProduct } from '../../../compiler/structure/contract';
import type { CompiledModel } from '../../../model/compiled';
import {
  cubeGeometryPivot,
  sealCanonicalBoneFrame,
  type ProjectDocument,
  type SceneNode,
  type Vec3,
} from '../../../model';
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
  GltfImage,
  GltfMaterial,
  GltfMesh,
  GltfNode,
  GltfPrimitive,
  GltfSampler,
} from './contract';
import { compileGltfCubePrimitiveData } from './cube';
import type { GltfPrimitiveData } from './data';
import { compileGltfPlanePrimitiveData } from './plane';
import { compileGltfPrimitive } from './primitive';
import { gltfNodeGeometryRotation } from './rigid';
import {
  addVec3,
  isIdentityRotation,
  multiplyVec3,
  quaternionFromEuler,
  rotateVec3ByQuaternion,
  subtractVec3,
} from './spatial';

const GLTF_UNIT_SCALE = 1 / 16;

interface MaterialRegistry {
  readonly materials: GltfMaterial[];
  readonly texIndexById: ReadonlyMap<string, number>;
  readonly cache: Map<string, number>;
}

interface GltfBuildCtx {
  readonly textures: Readonly<Record<string, TextureAsset>>;
  readonly matReg: MaterialRegistry;
  readonly writer: GltfBinaryWriter;
}

const getMaterialIndex = (
  reg: MaterialRegistry,
  tex: TextureAsset,
  mode: 'opaque' | 'cutout' | 'emissive' | 'model',
  masked = false,
): number => {
  const isCutout = mode === 'cutout' || masked;
  const isEmissive = mode === 'emissive' || tex.renderMode === 'emissive';
  const doubleSided = isCutout || tex.renderSides === 'double';
  const key = `${tex.id}:${isCutout ? 'M' : isEmissive ? 'E' : tex.renderMode}:${doubleSided ? 'D' : 'S'}`;
  const hit = reg.cache.get(key);
  if (hit !== undefined) return hit;
  const texIndex = reg.texIndexById.get(tex.id)!;
  const mat: GltfMaterial = {
    name: tex.name,
    pbrMetallicRoughness: {
      baseColorTexture: { index: texIndex },
      metallicFactor: 0,
      roughnessFactor: 1,
    },
    ...(isEmissive ? { emissiveTexture: { index: texIndex }, emissiveFactor: [1, 1, 1] } : {}),
    ...(isCutout
      ? { alphaMode: 'MASK', alphaCutoff: 0.5 }
      : tex.renderMode === 'additive' || tex.renderMode === 'layered'
        ? { alphaMode: 'BLEND' }
        : {}),
    ...(doubleSided ? { doubleSided: true } : {}),
  };
  const idx = reg.materials.length;
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
  for (const node of Object.values(model.scene.nodes))
    if (node.kind === 'bone') sealCanonicalBoneFrame(node);
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

interface WorldTransform {
  readonly pos: Vec3;
  readonly rot: readonly [number, number, number, number];
  readonly scale: Vec3;
}

const multiplyQuat = (
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): readonly [number, number, number, number] => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

const localNodeTranslation = (doc: ProjectDocument, node: SceneNode): Vec3 => {
  if (node.kind === 'locator') return multiplyVec3(node.transform.position, GLTF_UNIT_SCALE);
  const parent = node.parentId ? doc.scene.nodes[node.parentId] : undefined;
  const pOrigin: Vec3 =
    parent && parent.kind === 'bone'
      ? addVec3(parent.transform.pivot, parent.transform.position)
      : [0, 0, 0];
  const pivot = node.kind === 'cube' ? cubeGeometryPivot(node) : node.transform.pivot;
  return multiplyVec3(
    subtractVec3(addVec3(pivot, node.transform.position), pOrigin),
    GLTF_UNIT_SCALE,
  );
};

const composeWorldTransform = (
  parent: WorldTransform,
  doc: ProjectDocument,
  node: SceneNode,
): WorldTransform => {
  const localT = localNodeTranslation(doc, node);
  const rotT = rotateVec3ByQuaternion(
    [localT[0] * parent.scale[0], localT[1] * parent.scale[1], localT[2] * parent.scale[2]],
    parent.rot,
  );
  const rotVec = gltfNodeGeometryRotation(node);
  const localQ = isIdentityRotation(rotVec) ? ([0, 0, 0, 1] as const) : quaternionFromEuler(rotVec);
  return {
    pos: [parent.pos[0] + rotT[0], parent.pos[1] + rotT[1], parent.pos[2] + rotT[2]],
    rot: multiplyQuat(parent.rot, localQ),
    scale: [
      parent.scale[0] * node.transform.scale[0],
      parent.scale[1] * node.transform.scale[1],
      parent.scale[2] * node.transform.scale[2],
    ],
  };
};

const normalizeVec = (x: number, y: number, z: number): [number, number, number] => {
  const len = Math.hypot(x, y, z);
  return len <= 1e-6 ? [0, 1, 0] : [x / len, y / len, z / len];
};

const transformPrimitiveData = (
  prim: GltfPrimitiveData,
  xf: WorldTransform,
  material: number | undefined,
): GltfPrimitiveData => {
  const positions: number[] = [];
  const normals: number[] = [];
  for (let i = 0; i < prim.positions.length; i += 3) {
    const p = rotateVec3ByQuaternion(
      [
        prim.positions[i]! * xf.scale[0],
        prim.positions[i + 1]! * xf.scale[1],
        prim.positions[i + 2]! * xf.scale[2],
      ],
      xf.rot,
    );
    positions.push(p[0] + xf.pos[0], p[1] + xf.pos[1], p[2] + xf.pos[2]);
    const n = rotateVec3ByQuaternion(
      [
        Math.abs(xf.scale[0]) <= 1e-6 ? 0 : prim.normals[i]! / xf.scale[0],
        Math.abs(xf.scale[1]) <= 1e-6 ? 0 : prim.normals[i + 1]! / xf.scale[1],
        Math.abs(xf.scale[2]) <= 1e-6 ? 0 : prim.normals[i + 2]! / xf.scale[2],
      ],
      xf.rot,
    );
    normals.push(...normalizeVec(n[0], n[1], n[2]));
  }
  const indices = [...prim.indices];
  if (xf.scale[0] * xf.scale[1] * xf.scale[2] < 0) {
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const tmp = indices[i + 1]!;
      indices[i + 1] = indices[i + 2]!;
      indices[i + 2] = tmp;
    }
  }
  return {
    positions,
    normals,
    ...(prim.uvs ? { uvs: prim.uvs } : {}),
    ...(material === undefined ? {} : { material }),
    indices,
  };
};

const appendNumbers = (dst: number[], src: readonly number[]): void => {
  for (let i = 0; i < src.length; i += 1) dst.push(src[i]!);
};

const compileMaterialGroup = (
  writer: GltfBinaryWriter,
  matKey: number,
  list: readonly GltfPrimitiveData[],
): GltfPrimitive => {
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
  return compileGltfPrimitive(
    writer,
    positions,
    normals,
    hasUvs ? uvs : undefined,
    undefined,
    matKey >= 0 ? matKey : undefined,
    indices,
  );
};

const mergeAndCompilePrimitives = (
  writer: GltfBinaryWriter,
  prims: readonly GltfPrimitiveData[],
): GltfPrimitive[] => {
  const byMat = new Map<number, GltfPrimitiveData[]>();
  for (const p of prims) {
    const key = p.material ?? -1;
    const list = byMat.get(key) ?? [];
    list.push(p);
    byMat.set(key, list);
  }
  return [...byMat.entries()]
    .sort(([a], [b]) => a - b)
    .map(([matKey, list]) => compileMaterialGroup(writer, matKey, list));
};

const buildCustomMaterialMaps = (texRemap: ReadonlyMap<string, string>, ctx: GltfBuildCtx) => {
  const materialByTextureId = new Map<string, number>();
  const singleSidedMaterialByTextureId = new Map<string, number>();
  for (const [origId, remappedId] of texRemap) {
    const tex = ctx.textures[remappedId];
    if (!tex) continue;
    materialByTextureId.set(origId, getMaterialIndex(ctx.matReg, tex, 'model', false));
    if (tex.renderSides === 'double')
      singleSidedMaterialByTextureId.set(origId, getMaterialIndex(ctx.matReg, tex, 'model', true));
  }
  return { materialByTextureId, singleSidedMaterialByTextureId };
};

const buildChildrenMap = (doc: ProjectDocument, visible: ReadonlySet<string>) => {
  const childrenMap = new Map<string | null, SceneNode[]>();
  for (const node of Object.values(doc.scene.nodes)) {
    if (!visible.has(node.id)) continue;
    const list = childrenMap.get(node.parentId) ?? [];
    list.push(node);
    childrenMap.set(node.parentId, list);
  }
  return childrenMap;
};

const appendCustomNodePrimitives = (
  doc: ProjectDocument,
  node: SceneNode,
  parentXf: WorldTransform,
  childrenMap: ReadonlyMap<string | null, SceneNode[]>,
  opts: Parameters<typeof compileGltfCubePrimitiveData>[2],
  collected: GltfPrimitiveData[],
): void => {
  const xf = composeWorldTransform(parentXf, doc, node);
  if (node.kind === 'cube' || node.kind === 'plane') {
    const raw =
      node.kind === 'cube'
        ? compileGltfCubePrimitiveData(doc, node, opts)
        : compileGltfPlanePrimitiveData(doc, node, opts);
    for (const p of raw) collected.push(transformPrimitiveData(p, xf, p.material));
  }
  const children = [...(childrenMap.get(node.id) ?? [])].sort((a, b) => compareText(a.id, b.id));
  for (const child of children) {
    appendCustomNodePrimitives(doc, child, xf, childrenMap, opts, collected);
  }
};

const bakeCustomModelMesh = (
  assetKey: string,
  model: CompiledModel,
  texRemap: ReadonlyMap<string, string>,
  ctx: GltfBuildCtx,
): GltfMesh => {
  const doc = modelStubDocument(assetKey, model);
  const visible = effectivelyVisibleSceneNodeIds(doc);
  const childrenMap = buildChildrenMap(doc, visible);
  const maps = buildCustomMaterialMaps(texRemap, ctx);
  const opts = {
    writer: ctx.writer,
    ...maps,
    unitScale: GLTF_UNIT_SCALE,
    cubeFaceOcclusion: compileOpaqueCubeFaceOcclusion(doc),
  };
  const collected: GltfPrimitiveData[] = [];
  const identity: WorldTransform = { pos: [0, 0, 0], rot: [0, 0, 0, 1], scale: [1, 1, 1] };
  for (const rootId of doc.scene.roots) {
    const root = doc.scene.nodes[rootId];
    if (root && visible.has(root.id))
      appendCustomNodePrimitives(doc, root, identity, childrenMap, opts, collected);
  }
  return { name: assetKey, primitives: mergeAndCompilePrimitives(ctx.writer, collected) };
};

const compileBakedVoxelMesh = (product: StructureProduct, ctx: GltfBuildCtx): GltfMesh | null => {
  const active = product.bakedMesh.batches.filter(
    (b) => b.indices.length > 0 && b.positions.length > 0,
  );
  if (active.length === 0) return null;
  const primitives = active.map((batch) => {
    const tex = ctx.textures[batch.textureId];
    const matIdx = tex ? getMaterialIndex(ctx.matReg, tex, batch.layer) : undefined;
    return compileGltfPrimitive(
      ctx.writer,
      batch.positions,
      batch.normals,
      batch.uvs,
      undefined,
      matIdx,
      batch.indices,
      undefined,
      batch.colors.length > 0 ? batch.colors : undefined,
    );
  });
  return { name: `${product.id}_voxels`, primitives };
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
): void => {
  const meshByModel = new Map<CompiledModel, number>();
  for (const inst of product.bakedMesh.instances) {
    const model = product.customModels[inst.assetKey];
    if (!model) continue;
    let meshIdx = meshByModel.get(model);
    if (meshIdx === undefined) {
      const baked = bakeCustomModelMesh(inst.assetKey, model, modelTexRemap.get(model)!, ctx);
      if (baked.primitives.length === 0) continue;
      meshIdx = meshes.length;
      meshes.push(baked);
      meshByModel.set(model, meshIdx);
    }
    children.push(nodes.length);
    nodes.push({
      name: `prop_${children.length}`,
      mesh: meshIdx,
      translation: [inst.translation[0], inst.translation[1], inst.translation[2]],
      ...(inst.rotation !== 0 ? { rotation: quaternionFromEuler([0, inst.rotation, 0]) } : {}),
    });
  }
};

const assembleStructureGltfDocument = (
  id: string,
  writer: GltfBinaryWriter,
  binary: Uint8Array,
  nodes: GltfNode[],
  meshes: GltfMesh[],
  ordered: readonly TextureAsset[],
  images: GltfImage[],
  samplers: GltfSampler[],
  materials: GltfMaterial[],
): GltfDocument => ({
  asset: { version: '2.0', generator: 'ashfox engine core' },
  ...(writer.state.usesMeshQuantization
    ? { extensionsUsed: ['KHR_mesh_quantization'], extensionsRequired: ['KHR_mesh_quantization'] }
    : {}),
  scene: 0,
  scenes: [{ name: id, nodes: [0] }],
  nodes,
  ...(binary.byteLength > 0
    ? {
        buffers: [{ byteLength: binary.byteLength }],
        bufferViews: writer.state.bufferViews,
        accessors: writer.state.accessors,
      }
    : {}),
  ...(meshes.length > 0 ? { meshes } : {}),
  ...(ordered.length > 0
    ? {
        images,
        samplers,
        textures: ordered.map((t, i) => ({ sampler: i, source: i, name: t.name })),
        materials,
      }
    : {}),
});

export const buildStructureGltf = (
  product: StructureProduct,
  options: { readonly quantize?: boolean } = {},
): BuiltStructureGltf => {
  const writer = new GltfBinaryWriter(options.quantize ?? true);
  const { textures, modelTexRemap } = collectUsedTextures(product);
  const ordered = Object.values(textures).sort((a, b) => compareText(a.id, b.id));
  const { images, samplers, texIndexById } = encodeGltfTextures(ordered, writer);
  const ctx: GltfBuildCtx = {
    textures,
    matReg: { materials: [], texIndexById, cache: new Map() },
    writer,
  };
  const meshes: GltfMesh[] = [];
  const nodes: GltfNode[] = [{ name: product.id }];
  const children: number[] = [];
  const voxelMesh = compileBakedVoxelMesh(product, ctx);
  if (voxelMesh) {
    meshes.push(voxelMesh);
    children.push(nodes.length);
    nodes.push({ name: `${product.id}_mesh`, mesh: 0 });
  }
  appendCustomInstances(product, modelTexRemap, ctx, meshes, nodes, children);
  if (children.length > 0) nodes[0]!.children = children;
  const binary = writer.toUint8Array();
  const document = assembleStructureGltfDocument(
    product.id,
    writer,
    binary,
    nodes,
    meshes,
    ordered,
    images,
    samplers,
    ctx.matReg.materials,
  );
  return { compiled: { document, binary, textureFiles: [] }, textures };
};
