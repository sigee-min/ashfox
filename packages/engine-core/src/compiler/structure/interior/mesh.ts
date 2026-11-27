import { clamp01 } from '@ashfox/internal-contracts';
import type { CompiledModel } from '../../../model/compiled';
import type { CubeFaceDirection } from '../../../model/scene';
import { getBatch, type BatchDraft } from '../batch';
import type { StructureBakedBatch, StructureGrid, StructurePropInstance } from '../contract';
import { FACE_BASIS, FACE_CORNER_TABLE } from '../lighting';
import { linearToSrgb } from '../vertexWeather';
import { SUBVOXEL_UNITS_PER_BLOCK, type SubVoxelBoxIR } from './contract';
import type { CompiledInteriorRoom } from './types';
import { bakeSubVoxelColors0, parseHexRgb, sampleRadiosityAt16 } from './radiosity';
import { buildSunShaftMeshPrimitives } from './sunShaft';

const DIRS6: readonly CubeFaceDirection[] = ['north', 'south', 'east', 'west', 'up', 'down'];
const U = SUBVOXEL_UNITS_PER_BLOCK;

const rotateCorner = (
  x: number,
  y: number,
  z: number,
  pivot: readonly [number, number, number] | undefined,
  cos: number,
  sin: number,
): readonly [number, number, number] => {
  if (!pivot || (cos === 1 && sin === 0)) return [x, y, z];
  const dx = x - pivot[0];
  const dz = z - pivot[2];
  return [pivot[0] + dx * cos - dz * sin, y, pivot[2] + dx * sin + dz * cos];
};

const emitFaceQuad = (
  batch: BatchDraft,
  box: SubVoxelBoxIR,
  f: number,
  cols72: Float32Array,
  tint: readonly [number, number, number] | null,
  cos: number,
  sin: number,
  hw: number,
  hd: number,
  clampedToY: number,
): void => {
  const dir = DIRS6[f]!;
  const tbl = FACE_CORNER_TABLE[dir];
  const nrm = FACE_BASIS[dir].normal;
  const [rnx, rny, rnz] = rotateCorner(nrm[0], nrm[1], nrm[2], [0, 0, 0], cos, sin);
  const base = batch.positions.length / 3;
  const [tr, tg, tb] = tint ?? [1, 1, 1];
  for (let c = 0; c < 4; c += 1) {
    const k = c * 3;
    const cx16 = tbl[k]! ? box.to_16[0] : box.from_16[0];
    const cy16 = tbl[k + 1]! ? clampedToY : box.from_16[1];
    const cz16 = tbl[k + 2]! ? box.to_16[2] : box.from_16[2];
    const [rx, ry, rz] = rotateCorner(cx16, cy16, cz16, box.pivot_16, cos, sin);
    batch.positions.push(rx / U - hw, ry / U, rz / U - hd);
    batch.normals.push(rnx, rny, rnz);
    const colOff = f * 12 + k;
    batch.colors.push(
      clamp01(cols72[colOff]! * tr),
      clamp01(cols72[colOff + 1]! * tg),
      clamp01(cols72[colOff + 2]! * tb),
    );
  }
  batch.uvs.push(0, 1, 1, 1, 1, 0, 0, 0);
  batch.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
};

const emitBoxQuads = (
  batch: BatchDraft,
  box: SubVoxelBoxIR,
  cols72: Float32Array,
  hw: number,
  hd: number,
  maxY: number,
): void => {
  if (box.from_16[1] / U >= maxY) return;
  const rad = ((box.rotation_y_deg ?? 0) * Math.PI) / 180;
  const rot = Math.abs(rad) > 1e-4;
  const cos = rot ? Math.cos(rad) : 1;
  const sin = rot ? Math.sin(rad) : 0;
  const tint = parseHexRgb(box.color_tint);
  const clampedToY = Math.min(box.to_16[1], maxY * U);
  for (let f = 0; f < 6; f += 1) {
    emitFaceQuad(batch, box, f, cols72, tint, cos, sin, hw, hd, clampedToY);
  }
};

const emitSunShaftBatch = (
  batches: Map<string, BatchDraft>,
  room: CompiledInteriorRoom,
  hw: number,
  hd: number,
  maxY: number,
): void => {
  const visible = room.sun_shafts.filter((s) => s.corners[0][1] < maxY);
  if (visible.length === 0) return;
  const prim = buildSunShaftMeshPrimitives(visible);
  const key = 'sun_shaft:struct_sun_shaft_beam';
  const batch =
    batches.get(key) ??
    (() => {
      const b: BatchDraft = {
        layer: 'sun_shaft',
        tileId: 'sun_shaft_beam',
        textureId: 'struct_sun_shaft_beam',
        positions: [],
        normals: [],
        uvs: [],
        colors: [],
        indices: [],
      };
      batches.set(key, b);
      return b;
    })();
  const base = batch.positions.length / 3;
  for (let i = 0; i < prim.positions.length; i += 3) {
    batch.positions.push(
      prim.positions[i]! - hw,
      Math.min(maxY, prim.positions[i + 1]!),
      prim.positions[i + 2]! - hd,
    );
    batch.normals.push(prim.normals[i]!, prim.normals[i + 1]!, prim.normals[i + 2]!);
  }
  for (const uv of prim.uvs) batch.uvs.push(uv);
  for (let i = 0; i < prim.colors.length; i += 4) {
    const a = prim.colors[i + 3]!;
    batch.colors.push(
      clamp01(prim.colors[i]! * a),
      clamp01(prim.colors[i + 1]! * a),
      clamp01(prim.colors[i + 2]! * a),
    );
  }
  for (const idx of prim.indices) batch.indices.push(base + idx);
};

const emitRoomMounts = (
  room: CompiledInteriorRoom,
  customModels: Readonly<Record<string, CompiledModel>>,
  hw: number,
  hd: number,
  maxY: number,
  out: StructurePropInstance[],
): void => {
  const baseRotMap: Readonly<Record<string, number>> = {
    east: 270,
    south: 180,
    west: 90,
    north: 0,
  };
  for (const m of room.custom_mounts) {
    if (!customModels[m.asset_alias] || m.at_16[1] / U >= maxY) continue;
    const rgb = sampleRadiosityAt16(
      room.radiosity,
      room.input.bounds_from,
      m.at_16[0],
      m.at_16[1],
      m.at_16[2],
    );
    const deg = (baseRotMap[m.facing] ?? 0) + m.rotation_y_deg;
    const rot = ((((Math.round(deg / 90) * 90) % 360) + 360) % 360) as 0 | 90 | 180 | 270;
    out.push({
      assetKey: m.asset_alias,
      translation: [m.at_16[0] / U - hw, m.at_16[1] / U, m.at_16[2] / U - hd],
      rotation: rot,
      lightRgb: [linearToSrgb(rgb[0]), linearToSrgb(rgb[1]), linearToSrgb(rgb[2])],
    });
  }
};

/** Emits 1/16 sub-voxel interior geometry, 2-bounce COLOR_0 radiosity, translucent windows, and sun shafts. */
export const emitInteriorBakedMeshes = (
  grid: StructureGrid,
  batches: Map<string, BatchDraft>,
  customModels: Readonly<Record<string, CompiledModel>>,
  maxY: number,
): readonly StructurePropInstance[] => {
  const interiors = grid.interiors;
  if (!interiors || interiors.length === 0) return [];
  const [hw, hd] = [grid.size[0] / 2, grid.size[2] / 2];
  const extraInstances: StructurePropInstance[] = [];
  for (const room of interiors) {
    const colorsMap = bakeSubVoxelColors0(
      room.input,
      room.ir,
      room.radiosity,
      room.radiosity_config,
    );
    for (const box of room.ir.boxes) {
      const cols = colorsMap.get(box.id);
      if (!cols) continue;
      const layer = box.layer as StructureBakedBatch['layer'];
      const tileId =
        layer === 'translucent' && box.tile_id === 'glass' ? 'stained_glass' : box.tile_id;
      emitBoxQuads(getBatch(batches, layer, tileId), box, cols, hw, hd, maxY);
    }
    emitSunShaftBatch(batches, room, hw, hd, maxY);
    emitRoomMounts(room, customModels, hw, hd, maxY, extraInstances);
  }
  return extraInstances;
};

/** Returns true when a voxel glass_pane cell is already covered by a translucent window pane. */
export const isCoveredByTranslucentWindow = (
  grid: StructureGrid,
  x: number,
  y: number,
  z: number,
): boolean =>
  (grid.interiors ?? []).some((room) =>
    room.window_panes.some(
      (pane) =>
        x >= Math.floor(pane.box.from_16[0] / U) &&
        x <= Math.floor((pane.box.to_16[0] - 0.01) / U) &&
        y >= Math.floor(pane.box.from_16[1] / U) &&
        y <= Math.floor((pane.box.to_16[1] - 0.01) / U) &&
        z >= Math.floor(pane.box.from_16[2] / U) &&
        z <= Math.floor((pane.box.to_16[2] - 0.01) / U),
    ),
  );
