import type { CubeFaceDirection } from '../../model/scene';
import type { CardinalFacing } from '../../project/structure/contract';
import { structureTileTextureId } from './atlas';
import type { BlockDescriptor, BlockRenderLayer } from './blocks';
import type {
  StructureGrid,
  StructureLightingField,
  StructureOpeningMeta,
  StructureRoomMeta,
} from './contract';
import { computeFaceShade, FACE_BASIS, FACE_CORNER_TABLE } from './lighting';
import { setVec3, writeSpecBoxUv, type CachedBlockState, type LocalBoxSpec } from './shapes';
import {
  CARDINALS,
  OPPOSITE,
  OUTWARD,
  PERP_DIRS,
  chimneyCapSpecs,
  collectBeltCourseLevels,
  corbelStepSpecs,
  flowerBoxSpecs,
  isChimneyBrickTile,
  isSolidOpaqueAt,
  isTimberRoom,
  isTrueAirAt,
  openingSpan,
  pilasterSpecs,
  stripSpec,
  voxelAt,
  windowMullionSpecs,
} from './subvoxel';

export interface BatchDraft {
  readonly layer: BlockRenderLayer;
  readonly tileId: string;
  readonly textureId: string;
  readonly positions: number[];
  readonly normals: number[];
  readonly uvs: number[];
  readonly colors: number[];
  readonly indices: number[];
}

export interface NonFullScratch {
  readonly from: [number, number, number];
  readonly to: [number, number, number];
  readonly uvs: number[];
  readonly colors: number[];
}

export interface MeshCtx {
  readonly grid: StructureGrid;
  readonly descriptors: readonly BlockDescriptor[];
  readonly parsedStates: readonly CachedBlockState[];
  readonly lighting: StructureLightingField;
  readonly maxY: number;
  readonly batches: Map<string, BatchDraft>;
}

const DIRS6: readonly CubeFaceDirection[] = ['north', 'south', 'east', 'west', 'up', 'down'];

export const getBatch = (
  batches: Map<string, BatchDraft>,
  layer: BlockRenderLayer,
  tileId: string,
): BatchDraft => {
  const textureId = structureTileTextureId(layer, tileId);
  const key = `${layer}:${textureId}`;
  let batch = batches.get(key);
  if (!batch) {
    batch = {
      layer,
      tileId,
      textureId,
      positions: [],
      normals: [],
      uvs: [],
      colors: [],
      indices: [],
    };
    batches.set(key, batch);
  }
  return batch;
};

export const pushQuad = (
  batch: BatchDraft,
  dir: CubeFaceDirection,
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  uvs: readonly number[],
  colors: readonly number[],
  flip: boolean,
): void => {
  const base = batch.positions.length / 3;
  const t = FACE_CORNER_TABLE[dir];
  const normal = FACE_BASIS[dir].normal;
  for (let i = 0; i < 4; i += 1) {
    const k = i * 3;
    batch.positions.push(
      t[k]! ? to[0] : from[0],
      t[k + 1]! ? to[1] : from[1],
      t[k + 2]! ? to[2] : from[2],
    );
    batch.normals.push(normal[0], normal[1], normal[2]);
    batch.uvs.push(uvs[i * 2]!, uvs[i * 2 + 1]!);
    batch.colors.push(colors[k]!, colors[k + 1]!, colors[k + 2]!);
  }
  if (flip) batch.indices.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
  else batch.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
};

const emitTrimSpecs = (
  ctx: MeshCtx,
  scratch: NonFullScratch,
  vx: number,
  vy: number,
  vz: number,
  sx: number,
  sy: number,
  sz: number,
  specs: readonly LocalBoxSpec[],
): number => {
  if (vy < 0 || vy >= ctx.maxY) return 0;
  const [w, _h, d] = ctx.grid.size;
  let count = 0;
  for (const spec of specs) {
    setVec3(
      scratch.from,
      vx + spec.from[0] / 16 - w / 2,
      vy + spec.from[1] / 16,
      vz + spec.from[2] / 16 - d / 2,
    );
    setVec3(
      scratch.to,
      vx + spec.to[0] / 16 - w / 2,
      vy + spec.to[1] / 16,
      vz + spec.to[2] / 16 - d / 2,
    );
    const layer = spec.layer ?? 'opaque';
    const batch = getBatch(ctx.batches, layer, spec.tileOverride ?? 'timber_trim');
    for (const dir of DIRS6) {
      const shade = computeFaceShade(
        ctx.grid,
        ctx.descriptors,
        ctx.lighting,
        sx,
        sy,
        sz,
        dir,
        layer === 'emissive',
        ctx.maxY,
        false,
        scratch.colors,
      );
      writeSpecBoxUv(dir, spec, vx, vy, vz, scratch.uvs);
      pushQuad(batch, dir, scratch.from, scratch.to, scratch.uvs, shade.colors, shade.flip);
    }
    count += 6;
  }
  return count;
};

const emitStrip = (
  ctx: MeshCtx,
  scratch: NonFullScratch,
  vx: number,
  vy: number,
  vz: number,
  dir: CardinalFacing,
  depth: number,
  u0: number,
  u1: number,
  y0: number,
  y1: number,
  tileId: string,
): number => {
  const [ox, oz] = OUTWARD[dir];
  return emitTrimSpecs(ctx, scratch, vx, vy, vz, vx + ox, vy, vz + oz, [
    stripSpec(dir, depth, u0, u1, y0, y1, tileId),
  ]);
};

const solid = (ctx: MeshCtx, x: number, y: number, z: number): boolean =>
  isSolidOpaqueAt(ctx.grid, ctx.descriptors, x, y, z);

const air = (ctx: MeshCtx, x: number, y: number, z: number): boolean =>
  isTrueAirAt(ctx.grid, ctx.descriptors, x, y, z);

const emitPilasterColumn = (
  ctx: MeshCtx,
  scratch: NonFullScratch,
  room: StructureRoomMeta,
  cx: number,
  cz: number,
  ox: -1 | 1,
  oz: -1 | 1,
  seen: Set<string>,
): number => {
  let count = 0;
  const specs = pilasterSpecs(ox, oz);
  const yEnd = Math.min(room.to[1], ctx.maxY - 1);
  for (let y = room.from[1]; y <= yEnd; y += 1) {
    const key = `${cx},${y},${cz}`;
    if (seen.has(key) || !solid(ctx, cx, y, cz)) continue;
    if (!air(ctx, cx + ox, y, cz) || !air(ctx, cx, y, cz + oz)) continue;
    seen.add(key);
    count += emitTrimSpecs(ctx, scratch, cx, y, cz, cx + ox, y, cz + oz, specs);
  }
  return count;
};

const emitCornerPilasters = (ctx: MeshCtx, scratch: NonFullScratch): number => {
  let count = 0;
  const seen = new Set<string>();
  for (const room of ctx.grid.rooms) {
    if (!room.enclosed || !isTimberRoom(ctx.grid, ctx.descriptors, room)) continue;
    const corners: readonly [number, number, -1 | 1, -1 | 1][] = [
      [room.from[0], room.from[2], -1, -1],
      [room.to[0], room.from[2], 1, -1],
      [room.from[0], room.to[2], -1, 1],
      [room.to[0], room.to[2], 1, 1],
    ];
    for (const [cx, cz, ox, oz] of corners)
      count += emitPilasterColumn(ctx, scratch, room, cx, cz, ox, oz, seen);
  }
  return count;
};

const emitBeltCourseAt = (
  ctx: MeshCtx,
  scratch: NonFullScratch,
  x: number,
  y: number,
  z: number,
): number => {
  if (!solid(ctx, x, y, z)) return 0;
  let count = 0;
  for (const dir of CARDINALS) {
    const [ox, oz] = OUTWARD[dir];
    if (air(ctx, x + ox, y, z + oz))
      count += emitStrip(ctx, scratch, x, y, z, dir, 2.5, 0, 16, 0, 3.5, 'timber_trim');
  }
  return count;
};

const emitFloorBeltCourses = (ctx: MeshCtx, scratch: NonFullScratch): number => {
  const [w, _h, d] = ctx.grid.size;
  let count = 0;
  for (const y of collectBeltCourseLevels(ctx.grid)) {
    if (y <= 0 || y >= ctx.maxY) continue;
    for (let z = 0; z < d; z += 1)
      for (let x = 0; x < w; x += 1) count += emitBeltCourseAt(ctx, scratch, x, y, z);
  }
  return count;
};

const emitJettyCorbelAt = (
  ctx: MeshCtx,
  scratch: NonFullScratch,
  x: number,
  y: number,
  z: number,
): number => {
  const vy = y - 1;
  if (!solid(ctx, x, y, z) || voxelAt(ctx.grid, x, vy, z) > 0) return 0;
  const hitDir = CARDINALS.find((dir) => solid(ctx, x - OUTWARD[dir][0], vy, z - OUTWARD[dir][1]));
  return hitDir ? emitTrimSpecs(ctx, scratch, x, vy, z, x, vy, z, corbelStepSpecs(hitDir)) : 0;
};

const emitJettyCorbels = (ctx: MeshCtx, scratch: NonFullScratch): number => {
  const [w, _h, d] = ctx.grid.size;
  const ySet = new Set<number>();
  for (const f of ctx.grid.floors) if (f.y > 0) ySet.add(f.y);
  for (const r of ctx.grid.rooms) if (r.from[1] > 0) ySet.add(r.from[1]);
  let count = 0;
  for (const y of ySet) {
    if (y - 1 < 0 || y - 1 >= ctx.maxY) continue;
    for (let z = 0; z < d; z += 1)
      for (let x = 0; x < w; x += 1) count += emitJettyCorbelAt(ctx, scratch, x, y, z);
  }
  return count;
};

const emitOpeningJambs = (
  ctx: MeshCtx,
  scratch: NonFullScratch,
  op: StructureOpeningMeta,
  tileId: string,
): number => {
  const { tx, tz } = openingSpan(op);
  let count = 0;
  const lx = op.from[0] - tx;
  const lz = op.from[2] - tz;
  const rx = op.to[0] + tx;
  const rz = op.to[2] + tz;
  const yMax = Math.min(op.to[1], ctx.maxY - 1);
  for (let y = op.from[1]; y <= yMax; y += 1) {
    if (solid(ctx, lx, y, lz))
      count += emitStrip(ctx, scratch, lx, y, lz, op.wall, 2, 12, 16, 0, 16, tileId);
    if (solid(ctx, rx, y, rz))
      count += emitStrip(ctx, scratch, rx, y, rz, op.wall, 2, 0, 4, 0, 16, tileId);
  }
  return count;
};

const emitOpeningHeader = (
  ctx: MeshCtx,
  scratch: NonFullScratch,
  op: StructureOpeningMeta,
  tileId: string,
  withCornice: boolean,
): number => {
  const hy = op.to[1] + 1;
  if (hy >= ctx.maxY) return 0;
  const { tx, tz, len } = openingSpan(op);
  let count = 0;
  for (let u = -1; u <= len; u += 1) {
    const cx = op.from[0] + u * tx;
    const cz = op.from[2] + u * tz;
    if (!solid(ctx, cx, hy, cz)) continue;
    const u0 = u === -1 ? 12 : 0;
    const u1 = u === len ? 4 : 16;
    count += emitStrip(
      ctx,
      scratch,
      cx,
      hy,
      cz,
      op.wall,
      2.5,
      u0,
      u1,
      0,
      withCornice ? 5 : 4,
      tileId,
    );
    if (withCornice)
      count += emitStrip(ctx, scratch, cx, hy, cz, op.wall, 3.5, u0, u1, 5, 7, tileId);
  }
  return count;
};

const emitWindowSillAndBox = (
  ctx: MeshCtx,
  scratch: NonFullScratch,
  op: StructureOpeningMeta,
  cx: number,
  cz: number,
): number => {
  const sy = op.from[1] - 1;
  if (sy < 0 || sy >= ctx.maxY || !solid(ctx, cx, sy, cz)) return 0;
  let count = emitStrip(ctx, scratch, cx, sy, cz, op.wall, 2.5, 0, 16, 12, 16, 'timber_trim');
  const ax = cx + OUTWARD[op.wall][0];
  const az = cz + OUTWARD[op.wall][1];
  if (voxelAt(ctx.grid, ax, sy, az) <= 0 && voxelAt(ctx.grid, ax, sy + 1, az) <= 0) {
    count += emitTrimSpecs(ctx, scratch, ax, sy, az, ax, sy, az, flowerBoxSpecs(op.wall));
  }
  return count;
};

const emitWindowMullions = (
  ctx: MeshCtx,
  scratch: NonFullScratch,
  op: StructureOpeningMeta,
  cx: number,
  cz: number,
  alongX: boolean,
): number => {
  let count = 0;
  const specs = windowMullionSpecs(alongX);
  const yEnd = Math.min(op.to[1], ctx.maxY - 1);
  for (let y = op.from[1]; y <= yEnd; y += 1) {
    const v = voxelAt(ctx.grid, cx, y, cz);
    if (v > 0 && ctx.descriptors[v]!.shape !== 'pane')
      count += emitTrimSpecs(ctx, scratch, cx, y, cz, cx, y, cz, specs);
  }
  return count;
};

const emitWindowAndDoorTrims = (ctx: MeshCtx, scratch: NonFullScratch): number => {
  let count = 0;
  for (const op of ctx.grid.openings) {
    if (op.kind === 'window' || op.kind === 'bay_window') {
      count +=
        emitOpeningJambs(ctx, scratch, op, 'timber_trim') +
        emitOpeningHeader(ctx, scratch, op, 'timber_trim', false);
      const { alongX, tx, tz, len } = openingSpan(op);
      for (let u = 0; u < len; u += 1) {
        const cx = op.from[0] + u * tx;
        const cz = op.from[2] + u * tz;
        count +=
          emitWindowSillAndBox(ctx, scratch, op, cx, cz) +
          emitWindowMullions(ctx, scratch, op, cx, cz, alongX);
      }
    } else if (op.kind === 'door' || op.kind === 'arch' || op.kind === 'arcade') {
      const tile = op.kind === 'door' ? 'timber_trim' : 'stone_bricks';
      count +=
        emitOpeningJambs(ctx, scratch, op, tile) + emitOpeningHeader(ctx, scratch, op, tile, true);
    }
  }
  return count;
};

const emitRoofCellTrims = (
  ctx: MeshCtx,
  scratch: NonFullScratch,
  x: number,
  y: number,
  z: number,
): number => {
  const v = voxelAt(ctx.grid, x, y, z);
  if (v <= 0 || ctx.descriptors[v]!.shape !== 'stair') return 0;
  const cached = ctx.parsedStates[v]!;
  if (cached.parsed.properties.half === 'top') return 0;
  const eaveDir = OPPOSITE[cached.facing];
  const [ox, oz] = OUTWARD[eaveDir];
  let count = 0;
  if (voxelAt(ctx.grid, x + ox, y, z + oz) <= 0 && voxelAt(ctx.grid, x + ox, y - 1, z + oz) <= 0) {
    count += emitStrip(ctx, scratch, x, y, z, eaveDir, 2.5, 6, 10, 0, 3.5, 'dark_oak_planks');
    count += emitStrip(ctx, scratch, x, y, z, eaveDir, 1.5, 0, 16, 2, 4, 'dark_oak_planks');
  }
  for (const perp of PERP_DIRS[eaveDir]) {
    const [px, pz] = OUTWARD[perp];
    if (voxelAt(ctx.grid, x + px, y, z + pz) <= 0 && voxelAt(ctx.grid, x - px, y, z - pz) > 0) {
      count += emitStrip(ctx, scratch, x, y, z, perp, 2, 0, 16, 0, 4, 'dark_oak_planks');
    }
  }
  return count;
};

const emitRoofEavesAndBargeboards = (ctx: MeshCtx, scratch: NonFullScratch): number => {
  const [w, _h, d] = ctx.grid.size;
  let count = 0;
  for (let y = 1; y < ctx.maxY; y += 1) {
    for (let z = 0; z < d; z += 1)
      for (let x = 0; x < w; x += 1) count += emitRoofCellTrims(ctx, scratch, x, y, z);
  }
  return count;
};

const emitChimneyCellCap = (
  ctx: MeshCtx,
  scratch: NonFullScratch,
  x: number,
  y: number,
  z: number,
): number => {
  const v = voxelAt(ctx.grid, x, y, z);
  if (v <= 0) return 0;
  const desc = ctx.descriptors[v]!;
  if (desc.shape !== 'full' || !isChimneyBrickTile(desc.top)) return 0;
  if (voxelAt(ctx.grid, x, y - 1, z) !== v || voxelAt(ctx.grid, x, y - 2, z) !== v) return 0;
  const airSides = CARDINALS.filter(
    (c) => voxelAt(ctx.grid, x + OUTWARD[c][0], y, z + OUTWARD[c][1]) <= 0,
  ).length;
  if (airSides < 3) return 0;
  const above = voxelAt(ctx.grid, x, y + 1, z);
  const onSlab =
    above > 0 && ctx.descriptors[above]!.shape === 'slab' && voxelAt(ctx.grid, x, y + 2, z) <= 0;
  if (above > 0 && !onSlab) return 0;
  return emitTrimSpecs(
    ctx,
    scratch,
    x,
    y + 1,
    z,
    x,
    onSlab ? y + 2 : y + 1,
    z,
    chimneyCapSpecs(desc.top, onSlab),
  );
};

const emitChimneyCaps = (ctx: MeshCtx, scratch: NonFullScratch): number => {
  const [w, h, d] = ctx.grid.size;
  let count = 0;
  for (let y = 3; y < Math.min(ctx.maxY - 1, h - 1); y += 1) {
    for (let z = 0; z < d; z += 1)
      for (let x = 0; x < w; x += 1) count += emitChimneyCellCap(ctx, scratch, x, y, z);
  }
  return count;
};

export const emitArchitecturalTrims = (ctx: MeshCtx, scratch: NonFullScratch): number =>
  emitCornerPilasters(ctx, scratch) +
  emitFloorBeltCourses(ctx, scratch) +
  emitJettyCorbels(ctx, scratch) +
  emitWindowAndDoorTrims(ctx, scratch) +
  emitRoofEavesAndBargeboards(ctx, scratch) +
  emitChimneyCaps(ctx, scratch);
