import type { Vec3 } from '../../model/identity';
import {
  sealCanonicalBoneFrame,
  type AxisCubeNode,
  type BoneNode,
  type CubeFace,
  type SceneNode,
} from '../../model/scene';
import type { CompiledModel } from '../../model/compiled';
import type { ProjectDocument } from '../../model/document';
import type { TextureAsset } from '../../model/texture';
import { createProjectDocument } from '../../project/create';
import type { CardinalFacing } from '../../project/structure/contract';
import { parseBlockState } from '../../project/structure/state';
import { buildStructureAtlases, type TileUvRef } from './atlas';
import { describeBlockState, type BlockDescriptor } from './blocks';
import type { StructureGrid } from './contract';
import { buildNonFullCubes, makeBoxFaces, type CachedBlockState } from './shapes';

const CARDINAL_DELTAS: readonly [number, number, number][] = [
  [0, 0, -1],
  [0, 0, 1],
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
];

const makeBone = (
  id: string,
  name: string,
  parentId: string | null,
  pivot: Vec3 = [0, 0, 0],
  rotation: Vec3 = [0, 0, 0],
  scale: Vec3 = [1, 1, 1],
): BoneNode => {
  const bone: BoneNode = {
    id,
    kind: 'bone',
    name,
    parentId,
    transform: { position: [0, 0, 0], rotation: [...rotation] as Vec3, scale, pivot },
    visible: true,
    canonicalFrame: {
      origin: pivot,
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      zAxis: [0, 0, 1],
      determinant: 1,
      rotation: [...rotation] as Vec3,
    },
  };
  sealCanonicalBoneFrame(bone);
  return bone;
};

const collectTileRequests = (
  grid: StructureGrid,
  descriptors: readonly BlockDescriptor[],
  cutawayY: number,
): readonly { readonly layer: BlockDescriptor['layer']; readonly tileId: string }[] => {
  const reqs: { readonly layer: BlockDescriptor['layer']; readonly tileId: string }[] = [];
  const [w, h, d] = grid.size;
  const maxY = Math.min(h, cutawayY);
  for (let y = 0; y < maxY; y += 1) {
    for (let z = 0; z < d; z += 1) {
      for (let x = 0; x < w; x += 1) {
        const idx = (y * d + z) * w + x;
        if (grid.customTags[idx] !== null || grid.voxels[idx]! <= 0) continue;
        const desc = descriptors[grid.voxels[idx]!]!;
        for (const t of [desc.top, desc.bottom, desc.side, desc.front]) {
          reqs.push({ layer: desc.layer, tileId: t });
        }
      }
    }
  }
  return reqs;
};

const isOpaqueFullAt = (
  grid: StructureGrid,
  descriptors: readonly BlockDescriptor[],
  x: number,
  y: number,
  z: number,
  cutawayY: number,
): boolean => {
  const [w, h, d] = grid.size;
  if (x < 0 || x >= w || y < 0 || y >= Math.min(h, cutawayY) || z < 0 || z >= d) return false;
  const idx = (y * d + z) * w + x;
  if (grid.customTags[idx] !== null || grid.voxels[idx]! <= 0) return false;
  return descriptors[grid.voxels[idx]!]!.solidOpaque;
};

const connectsNeighborAt = (
  grid: StructureGrid,
  descriptors: readonly BlockDescriptor[],
  x: number,
  y: number,
  z: number,
  ownShape: BlockDescriptor['shape'],
  cutawayY: number,
): boolean => {
  const [w, h, d] = grid.size;
  if (x < 0 || x >= w || y < 0 || y >= Math.min(h, cutawayY) || z < 0 || z >= d) return false;
  const idx = (y * d + z) * w + x;
  if (grid.voxels[idx]! <= 0) return false;
  const nDesc = descriptors[grid.voxels[idx]!]!;
  return nDesc.solidOpaque || nDesc.shape === ownShape;
};

const fullCubeNode = (
  id: string,
  parentId: string,
  ox: number,
  oy: number,
  oz: number,
  facing: CardinalFacing,
  desc: BlockDescriptor,
  visibleFaces: readonly boolean[],
  uvs: ReadonlyMap<string, TileUvRef>,
): AxisCubeNode => ({
  id,
  kind: 'cube',
  name: id,
  parentId,
  geometryMode: 'axis-box',
  bounds: { from: [ox, oy, oz], to: [ox + 16, oy + 16, oz + 16] },
  transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], pivot: [0, 0, 0] },
  visible: true,
  inflate: 0,
  mirror: false,
  boxUv: false,
  faces: makeBoxFaces(desc, facing, uvs, visibleFaces),
});

const facingRotY = (facing: CardinalFacing): number =>
  facing === 'east' ? 270 : facing === 'south' ? 180 : facing === 'west' ? 90 : 0;

const remapFaces = (
  faces: Readonly<Record<string, CubeFace>>,
  texRemap: ReadonlyMap<string, string>,
): Record<string, CubeFace> => {
  const out: Record<string, CubeFace> = {};
  for (const [k, f] of Object.entries(faces)) {
    out[k] = { ...f, textureId: f.textureId ? (texRemap.get(f.textureId) ?? f.textureId) : null };
  }
  return out;
};

const offsetVec3 = (v: Vec3, dx: number, dy: number, dz: number): Vec3 => [
  v[0] + dx,
  v[1] + dy,
  v[2] + dz,
];

const cloneCubeNode = (
  nid: string,
  pid: string,
  node: AxisCubeNode | Extract<SceneNode, { kind: 'cube'; geometryMode: 'oriented-box' }>,
  wx: number,
  wy: number,
  wz: number,
  texRemap: ReadonlyMap<string, string>,
): SceneNode => {
  const faces = remapFaces(node.faces, texRemap) as AxisCubeNode['faces'];
  const transform = { ...node.transform, pivot: offsetVec3(node.transform.pivot, wx, wy, wz) };
  if (node.geometryMode === 'axis-box') {
    return {
      ...node,
      id: nid,
      parentId: pid,
      bounds: {
        from: offsetVec3(node.bounds.from, wx, wy, wz),
        to: offsetVec3(node.bounds.to, wx, wy, wz),
      },
      transform,
      faces,
    };
  }
  return {
    ...node,
    id: nid,
    parentId: pid,
    orientedBox: {
      ...node.orientedBox,
      unrotatedFrom: offsetVec3(node.orientedBox.unrotatedFrom, wx, wy, wz),
      unrotatedTo: offsetVec3(node.orientedBox.unrotatedTo, wx, wy, wz),
      pivot: offsetVec3(node.orientedBox.pivot, wx, wy, wz),
    },
    transform,
    faces,
  };
};

const cloneCustomNode = (
  prefix: string,
  cellBoneId: string,
  node: SceneNode,
  wx: number,
  wy: number,
  wz: number,
  texRemap: ReadonlyMap<string, string>,
): SceneNode => {
  const nid = `${prefix}_${node.id}`;
  const pid = node.parentId ? `${prefix}_${node.parentId}` : cellBoneId;
  if (node.kind === 'bone') {
    const clonedPivot = offsetVec3(node.transform.pivot, wx, wy, wz);
    const frame = node.canonicalFrame;
    const bone: BoneNode = {
      ...node,
      id: nid,
      name: nid,
      parentId: pid,
      transform: {
        ...node.transform,
        position: [...node.transform.position] as Vec3,
        rotation: [...node.transform.rotation] as Vec3,
        scale: [...node.transform.scale] as Vec3,
        pivot: clonedPivot,
      },
      canonicalFrame: frame
        ? {
            origin: offsetVec3(frame.origin, wx, wy, wz),
            xAxis: [...frame.xAxis] as Vec3,
            yAxis: [...frame.yAxis] as Vec3,
            zAxis: [...frame.zAxis] as Vec3,
            determinant: frame.determinant,
            rotation: [...frame.rotation] as Vec3,
          }
        : undefined,
    };
    sealCanonicalBoneFrame(bone);
    return bone;
  }
  if (node.kind === 'cube') return cloneCubeNode(nid, pid, node, wx, wy, wz, texRemap);
  return {
    ...node,
    id: nid,
    parentId: pid,
    transform: {
      ...node.transform,
      position: offsetVec3(node.transform.position, wx, wy, wz),
      pivot: offsetVec3(node.transform.pivot, wx, wy, wz),
    },
    ...(node.kind === 'plane'
      ? { faces: remapFaces(node.faces, texRemap) as typeof node.faces }
      : {}),
  };
};

const getModelTextureRemap = (
  model: CompiledModel,
  texRemapCache: Map<CompiledModel, ReadonlyMap<string, string>>,
  textures: Record<string, TextureAsset>,
): ReadonlyMap<string, string> => {
  const cached = texRemapCache.get(model);
  if (cached) return cached;
  const texRemap = new Map<string, string>();
  for (const [tid, tex] of Object.entries(model.textures)) {
    const newId = `c_${tid}`;
    texRemap.set(tid, newId);
    if (!textures[newId]) textures[newId] = { ...tex, id: newId };
  }
  texRemapCache.set(model, texRemap);
  return texRemap;
};

const appendCustomModel = (
  placementIndex: number,
  wx: number,
  wy: number,
  wz: number,
  facing: CardinalFacing,
  model: CompiledModel,
  nodes: Record<string, SceneNode>,
  texRemap: ReadonlyMap<string, string>,
): void => {
  const prefix = `c_${placementIndex}`;
  const cellBoneId = `custom_cell_${placementIndex}`;
  nodes[cellBoneId] = makeBone(
    cellBoneId,
    cellBoneId,
    'custom',
    [wx, wy, wz],
    [0, facingRotY(facing), 0],
  );
  for (const node of Object.values(model.scene.nodes)) {
    const cloned = cloneCustomNode(prefix, cellBoneId, node, wx, wy, wz, texRemap);
    nodes[cloned.id] = cloned;
  }
};

const appendVoxelNodes = (
  grid: StructureGrid,
  descriptors: readonly BlockDescriptor[],
  parsedStates: readonly CachedBlockState[],
  uvs: ReadonlyMap<string, TileUvRef>,
  cutawayY: number,
  nodes: Record<string, SceneNode>,
): void => {
  const [w, h, d] = grid.size;
  const halfW = (w * 16) / 2;
  const halfD = (d * 16) / 2;
  const maxY = Math.min(h, cutawayY);
  for (let y = 0; y < maxY; y += 1) {
    for (let z = 0; z < d; z += 1) {
      for (let x = 0; x < w; x += 1) {
        appendSingleVoxel(
          grid,
          descriptors,
          parsedStates,
          uvs,
          cutawayY,
          halfW,
          halfD,
          x,
          y,
          z,
          nodes,
        );
      }
    }
  }
};

const appendSingleVoxel = (
  grid: StructureGrid,
  descriptors: readonly BlockDescriptor[],
  parsedStates: readonly CachedBlockState[],
  uvs: ReadonlyMap<string, TileUvRef>,
  cutawayY: number,
  halfW: number,
  halfD: number,
  x: number,
  y: number,
  z: number,
  nodes: Record<string, SceneNode>,
): void => {
  const [w, _h, d] = grid.size;
  const idx = (y * d + z) * w + x;
  const voxel = grid.voxels[idx]!;
  if (grid.customTags[idx] !== null || voxel <= 0) return;
  const cachedState = parsedStates[voxel]!;
  const desc = descriptors[voxel]!;
  const ox = x * 16 - halfW;
  const oy = y * 16;
  const oz = z * 16 - halfD;
  if (desc.shape === 'full') {
    const vis = CARDINAL_DELTAS.map(
      ([dx, dy, dz]) =>
        !desc.solidOpaque || !isOpaqueFullAt(grid, descriptors, x + dx, y + dy, z + dz, cutawayY),
    );
    if (vis.some(Boolean))
      nodes[`v_${x}_${y}_${z}`] = fullCubeNode(
        `v_${x}_${y}_${z}`,
        desc.zone,
        ox,
        oy,
        oz,
        cachedState.facing,
        desc,
        vis,
        uvs,
      );
    return;
  }
  const conns = CARDINAL_DELTAS.slice(0, 4).map(([dx, dy, dz]) =>
    connectsNeighborAt(grid, descriptors, x + dx, y + dy, z + dz, desc.shape, cutawayY),
  );
  for (const cube of buildNonFullCubes(
    `v_${x}_${y}_${z}`,
    desc.zone,
    ox,
    oy,
    oz,
    cachedState,
    desc,
    conns,
    uvs,
  )) {
    nodes[cube.id] = cube;
  }
};

const cachePaletteStates = (states: readonly string[]): readonly CachedBlockState[] =>
  states.map((state) => {
    const parsed = parseBlockState(state);
    const raw = parsed.properties.facing;
    const facing: CardinalFacing =
      raw === 'south' || raw === 'east' || raw === 'west' ? raw : 'north';
    return { parsed, facing };
  });

export const buildStructureDocument = (
  grid: StructureGrid,
  customModels: Readonly<Record<string, CompiledModel>>,
  options?: { readonly cutawayY?: number },
): ProjectDocument => {
  const [w, h, d] = grid.size;
  const cutawayY = options?.cutawayY ?? h;
  const descriptors = grid.states.map(describeBlockState);
  const parsedStates = cachePaletteStates(grid.states);
  const atlas = buildStructureAtlases(collectTileRequests(grid, descriptors, cutawayY));
  const textures: Record<string, TextureAsset> = { ...atlas.textures };
  const nodes: Record<string, SceneNode> = {
    root: makeBone('root', 'root', null),
    exterior: makeBone('exterior', 'exterior', 'root'),
    interior: makeBone('interior', 'interior', 'root'),
    custom: makeBone('custom', 'custom', 'root'),
  };
  appendVoxelNodes(grid, descriptors, parsedStates, atlas.uvs, cutawayY, nodes);
  const texRemapCache = new Map<CompiledModel, ReadonlyMap<string, string>>();
  let customIdx = 0;
  for (const cp of grid.customPlacements) {
    if (cp.y >= cutawayY || !customModels[cp.assetAlias]) continue;
    const model = customModels[cp.assetAlias]!;
    appendCustomModel(
      customIdx++,
      cp.x * 16 - (w * 16) / 2 + 8,
      cp.y * 16,
      cp.z * 16 - (d * 16) / 2 + 8,
      cp.facing,
      model,
      nodes,
      getModelTextureRemap(model, texRemapCache, textures),
    );
  }
  const doc = createProjectDocument({
    id: grid.id,
    name: grid.id,
    revision: 'structure-1',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  doc.settings.forward = 'north';
  doc.settings.textureResolution = { width: 64, height: 64 };
  doc.scene = { roots: ['root'], nodes };
  doc.textures = textures;
  return doc;
};
