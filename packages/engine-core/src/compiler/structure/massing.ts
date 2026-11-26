import type {
  CardinalFacing,
  FacadeOpeningSpec,
  IntVec3,
  PorchSpec,
  StructureOp,
} from '../../project/structure/contract';
import {
  formatBlockState,
  parseBlockState,
  withBlockProperties,
} from '../../project/structure/state';
import { isOctagonOutside } from './octagon';
import type { StructureRoomMeta } from './contract';

export interface FloorRoomEnvelope {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

const OPPOSITE: Readonly<Record<CardinalFacing, CardinalFacing>> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
};

const STAIR_FROM_KEY: readonly [string, string][] = [
  ['dark_oak', 'minecraft:dark_oak_stairs'],
  ['spruce', 'minecraft:spruce_stairs'],
  ['birch', 'minecraft:birch_stairs'],
  ['oak', 'minecraft:oak_stairs'],
  ['deepslate_tile', 'minecraft:deepslate_tile_stairs'],
  ['deepslate', 'minecraft:deepslate_brick_stairs'],
  ['stone_brick', 'minecraft:stone_brick_stairs'],
  ['brick', 'minecraft:brick_stairs'],
  ['cobble', 'minecraft:cobblestone_stairs'],
];

const inferCorbelStair = (rawState: string): string => {
  const parsed = parseBlockState(rawState).name;
  if (parsed.endsWith('_stairs')) return parsed;
  const hit = STAIR_FROM_KEY.find(([tok]) => parsed.includes(tok));
  return hit ? hit[1] : 'minecraft:spruce_stairs';
};

const beamWithAxis = (rawState: string, axis: 'x' | 'y' | 'z'): string => {
  const parsed = parseBlockState(rawState);
  if (!('axis' in parsed.properties) && !parsed.name.includes('log')) return rawState;
  return formatBlockState({ name: parsed.name, properties: { ...parsed.properties, axis } });
};

export const collectFloorEnvelope = (
  ops: readonly StructureOp[],
  evalV2: (vec: readonly [string | number, string | number]) => readonly [number, number],
): FloorRoomEnvelope | null => {
  let env: { minX: number; maxX: number; minZ: number; maxZ: number } | null = null;
  for (const op of ops) {
    if (op.op !== 'room') continue;
    const [rx, rz] = evalV2(op.from);
    const [rw, rd] = evalV2(op.size);
    const x1 = rx + rw - 1;
    const z1 = rz + rd - 1;
    if (!env) env = { minX: rx, maxX: x1, minZ: rz, maxZ: z1 };
    else {
      env.minX = Math.min(env.minX, rx);
      env.maxX = Math.max(env.maxX, x1);
      env.minZ = Math.min(env.minZ, rz);
      env.maxZ = Math.max(env.maxZ, z1);
    }
  }
  return env;
};

export const expandRoomForJetty = (
  rx: number,
  rz: number,
  rw: number,
  rd: number,
  envelope: FloorRoomEnvelope | null,
  jetty: Readonly<Partial<Record<CardinalFacing, number>>> | undefined,
): {
  readonly rx: number;
  readonly rz: number;
  readonly rw: number;
  readonly rd: number;
  readonly edges: Readonly<Partial<Record<CardinalFacing, number>>>;
} => {
  if (!jetty || !envelope) return { rx, rz, rw, rd, edges: {} };
  const edges: Partial<Record<CardinalFacing, number>> = {};
  const jW = rx === envelope.minX ? (jetty.west ?? 0) : 0;
  const jE = rx + rw - 1 === envelope.maxX ? (jetty.east ?? 0) : 0;
  const jN = rz === envelope.minZ ? (jetty.north ?? 0) : 0;
  const jS = rz + rd - 1 === envelope.maxZ ? (jetty.south ?? 0) : 0;
  if (jW > 0) edges.west = jW;
  if (jE > 0) edges.east = jE;
  if (jN > 0) edges.north = jN;
  if (jS > 0) edges.south = jS;
  return { rx: rx - jW, rz: rz - jN, rw: rw + jW + jE, rd: rd + jN + jS, edges };
};

interface JettyDirBounds {
  readonly dir: CardinalFacing;
  readonly dist: number;
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
}

const jettyDirStrips = (
  from: IntVec3,
  to: IntVec3,
  edges: Readonly<Partial<Record<CardinalFacing, number>>>,
): readonly JettyDirBounds[] => {
  const list: JettyDirBounds[] = [];
  if (edges.north)
    list.push({
      dir: 'north',
      dist: edges.north,
      x0: from[0],
      x1: to[0],
      z0: from[2],
      z1: from[2] + edges.north - 1,
    });
  if (edges.south)
    list.push({
      dir: 'south',
      dist: edges.south,
      x0: from[0],
      x1: to[0],
      z0: to[2] - edges.south + 1,
      z1: to[2],
    });
  if (edges.west)
    list.push({
      dir: 'west',
      dist: edges.west,
      x0: from[0],
      x1: from[0] + edges.west - 1,
      z0: from[2],
      z1: to[2],
    });
  if (edges.east)
    list.push({
      dir: 'east',
      dist: edges.east,
      x0: to[0] - edges.east + 1,
      x1: to[0],
      z0: from[2],
      z1: to[2],
    });
  return list;
};

export interface JettyEmitCtx {
  readonly ownerPath: string;
  readonly shape: 'rect' | 'octagon' | undefined;
  readonly from: IntVec3;
  readonly to: IntVec3;
  readonly edges: Readonly<Partial<Record<CardinalFacing, number>>>;
  readonly beamKey: string | undefined;
  readonly isEmpty: (x: number, y: number, z: number) => boolean;
  readonly put: (pos: IntVec3, state: string, alias: string | null) => void;
  readonly resolve: (
    key: string,
    owner: string,
    pos: IntVec3,
  ) => { readonly state: string; readonly assetAlias: string | null };
}

const jettyBeamAxis = (ctx: JettyEmitCtx, x: number, z: number, ns: boolean): 'x' | 'y' | 'z' => {
  const onX = x === ctx.from[0] || x === ctx.to[0];
  const onZ = z === ctx.from[2] || z === ctx.to[2];
  return onX && onZ ? 'y' : ns ? 'x' : 'z';
};

const emitJettyCell = (
  ctx: JettyEmitCtx,
  strip: JettyDirBounds,
  corbelStair: string,
  x: number,
  z: number,
): void => {
  if (ctx.shape === 'octagon' && isOctagonOutside(x, z, ctx.from, ctx.to)) return;
  const yFloor = ctx.from[1];
  const ns = strip.dir === 'north' || strip.dir === 'south';
  if (ctx.beamKey) {
    const res = ctx.resolve(ctx.beamKey, ctx.ownerPath, [x, yFloor, z]);
    ctx.put([x, yFloor, z], beamWithAxis(res.state, jettyBeamAxis(ctx, x, z, ns)), res.assetAlias);
  }
  const u = ns ? x - strip.x0 : z - strip.z0;
  const uMax = ns ? strip.x1 - strip.x0 : strip.z1 - strip.z0;
  if (yFloor >= 1 && (u % 2 === 0 || u === uMax) && ctx.isEmpty(x, yFloor - 1, z)) {
    const state = withBlockProperties(corbelStair, { facing: OPPOSITE[strip.dir], half: 'top' });
    ctx.put([x, yFloor - 1, z], state, null);
  }
};

const emitJettyStrip = (ctx: JettyEmitCtx, strip: JettyDirBounds, corbelStair: string): void => {
  for (let z = strip.z0; z <= strip.z1; z += 1) {
    for (let x = strip.x0; x <= strip.x1; x += 1) emitJettyCell(ctx, strip, corbelStair, x, z);
  }
};

export const emitJettyApronAndCorbels = (ctx: JettyEmitCtx): void => {
  const strips = jettyDirStrips(ctx.from, ctx.to, ctx.edges);
  if (strips.length === 0) return;
  const sample = ctx.beamKey ? ctx.resolve(ctx.beamKey, ctx.ownerPath, ctx.from).state : 'spruce';
  const corbelStair = inferCorbelStair(sample);
  for (const strip of strips) emitJettyStrip(ctx, strip, corbelStair);
};

export interface PorchEmitCtx {
  readonly ownerPath: string;
  readonly wall: CardinalFacing;
  readonly roomFromY: number;
  readonly shape: 'rect' | 'octagon' | undefined;
  readonly spanLen: number;
  readonly cellAt: (u: number, d?: number) => readonly [number, number];
  readonly put: (x: number, y: number, z: number, state: string, alias: string | null) => void;
  readonly resolve: (
    key: string,
    owner: string,
    pos: IntVec3,
  ) => { readonly state: string; readonly assetAlias: string | null };
}

const emitPorchPillars = (
  ctx: PorchEmitCtx,
  uStart: number,
  uEnd: number,
  yBase: number,
  yTop: number,
  porch: PorchSpec,
): void => {
  if (!porch.pillars) return;
  for (const pu of [uStart, uEnd]) {
    const [px, pz] = ctx.cellAt(pu, porch.depth);
    for (let py = yBase; py <= yTop + 1; py += 1) {
      const res = ctx.resolve(porch.pillars, ctx.ownerPath, [px, py, pz]);
      ctx.put(px, py, pz, res.state, res.assetAlias);
    }
    if (porch.lamps) {
      const lamp = ctx.resolve(porch.lamps, ctx.ownerPath, [px, yTop + 2, pz]);
      ctx.put(px, yTop + 2, pz, lamp.state, lamp.assetAlias);
    }
  }
  for (let d = 1; d <= porch.depth; d += 1) {
    for (let u = uStart; u <= uEnd; u += 1) {
      const [cx, cz] = ctx.cellAt(u, d);
      const cap = ctx.resolve(porch.floor, ctx.ownerPath, [cx, yTop + 1, cz]);
      ctx.put(cx, yTop + 1, cz, cap.state, cap.assetAlias);
    }
  }
};

export const emitPorchStructure = (
  ctx: PorchEmitCtx,
  u0: number,
  yBase: number,
  yTop: number,
  width: number,
  porch: PorchSpec,
): void => {
  const minU = ctx.shape === 'octagon' ? 0 : -1;
  const maxU = ctx.shape === 'octagon' ? ctx.spanLen - 1 : ctx.spanLen;
  const uStart = Math.max(minU, u0 - 1);
  const uEnd = Math.min(maxU, u0 + width);
  for (let d = 1; d <= porch.depth; d += 1) {
    for (let u = uStart; u <= uEnd; u += 1) {
      const [px, pz] = ctx.cellAt(u, d);
      const res = ctx.resolve(porch.floor, ctx.ownerPath, [px, ctx.roomFromY, pz]);
      ctx.put(px, ctx.roomFromY, pz, res.state, res.assetAlias);
    }
  }
  if (porch.steps) {
    for (let u = u0; u < u0 + width; u += 1) {
      const [sx, sz] = ctx.cellAt(u, porch.depth);
      const res = ctx.resolve(porch.steps, ctx.ownerPath, [sx, ctx.roomFromY, sz]);
      ctx.put(
        sx,
        ctx.roomFromY,
        sz,
        withBlockProperties(res.state, { facing: OPPOSITE[ctx.wall], half: 'bottom' }),
        null,
      );
    }
  }
  emitPorchPillars(ctx, uStart, uEnd, yBase, yTop, porch);
};

export interface MassingOpeningCtx {
  readonly ownerPath: string;
  readonly wall: CardinalFacing;
  readonly roomFromY: number;
  readonly roomToY: number;
  readonly spanLen: number;
  readonly cellAt: (u: number, d?: number) => readonly [number, number];
  readonly put: (x: number, y: number, z: number, state: string, alias: string | null) => void;
  readonly carve: (x: number, y: number, z: number) => void;
  readonly resolve: (
    key: string,
    owner: string,
    pos: IntVec3,
  ) => { readonly state: string; readonly assetAlias: string | null };
}

const emitBayColumn = (
  ctx: MassingOpeningCtx,
  u: number,
  y0: number,
  y1: number,
  isSideGlass: boolean,
  glassKey: string,
  sillKey: string,
  hoodKey: string,
): void => {
  const [wx, wz] = ctx.cellAt(u, 0);
  const [bx, bz] = ctx.cellAt(u, 1);
  for (let y = y0; y <= y1; y += 1) {
    ctx.carve(wx, y, wz);
    if (isSideGlass) {
      const g0 = ctx.resolve(glassKey, ctx.ownerPath, [wx, y, wz]);
      ctx.put(wx, y, wz, g0.state, g0.assetAlias);
    }
    const g1 = ctx.resolve(glassKey, ctx.ownerPath, [bx, y, bz]);
    ctx.put(bx, y, bz, g1.state, g1.assetAlias);
  }
  if (y0 - 1 >= ctx.roomFromY) {
    const s = ctx.resolve(sillKey, ctx.ownerPath, [bx, y0 - 1, bz]);
    ctx.put(bx, y0 - 1, bz, s.state, s.assetAlias);
  }
  if (y1 + 1 <= ctx.roomToY) {
    const h = ctx.resolve(hoodKey, ctx.ownerPath, [bx, y1 + 1, bz]);
    const hoodState = parseBlockState(h.state).name.endsWith('_stairs')
      ? withBlockProperties(h.state, { facing: OPPOSITE[ctx.wall], half: 'bottom' })
      : h.state;
    ctx.put(bx, y1 + 1, bz, hoodState, h.assetAlias);
  }
};

export const emitBayWindow = (
  ctx: MassingOpeningCtx,
  u0: number,
  y0: number,
  y1: number,
  spec: FacadeOpeningSpec,
): void => {
  const glassKey = spec.glass ?? 'minecraft:glass_pane';
  const sillKey = spec.sill ?? spec.frame ?? 'minecraft:spruce_slab[type=top]';
  const hoodKey = spec.lintel ?? spec.sill ?? 'minecraft:spruce_slab[type=bottom]';
  for (let col = 0; col < spec.width; col += 1) {
    emitBayColumn(
      ctx,
      u0 + col,
      y0,
      y1,
      spec.width >= 3 && (col === 0 || col === spec.width - 1),
      glassKey,
      sillKey,
      hoodKey,
    );
  }
};

const emitArcadeGalleryLintel = (
  ctx: MassingOpeningCtx,
  u0: number,
  u1: number,
  yTop: number,
  lintel: string | undefined,
): void => {
  if (!lintel || yTop > ctx.roomToY) return;
  for (let u = u0 - 1; u <= u1 + 1; u += 1) {
    if (u < -1 || u > ctx.spanLen) continue;
    const [bx, bz] = ctx.cellAt(u, 1);
    const res = ctx.resolve(lintel, ctx.ownerPath, [bx, yTop, bz]);
    ctx.put(bx, yTop, bz, res.state, res.assetAlias);
  }
};

export const emitArcadeOpening = (
  ctx: MassingOpeningCtx,
  u0: number,
  y0: number,
  y1: number,
  spec: FacadeOpeningSpec,
  defaultWallKey: string | undefined,
): void => {
  const u1 = u0 + spec.width - 1;
  for (let col = 0; col < spec.width; col += 1) {
    const [wx, wz] = ctx.cellAt(u0 + col, 0);
    for (let y = y0; y <= y1; y += 1) ctx.carve(wx, y, wz);
  }
  const archSampleKey = spec.frame ?? spec.lintel ?? defaultWallKey ?? 'minecraft:stone_bricks';
  const archStair = inferCorbelStair(ctx.resolve(archSampleKey, ctx.ownerPath, [0, y1, 0]).state);
  if (spec.height >= 3 && spec.width >= 2) {
    const ns = ctx.wall === 'north' || ctx.wall === 'south';
    const [lx, lz] = ctx.cellAt(u0, 0);
    const [rx, rz] = ctx.cellAt(u1, 0);
    ctx.put(
      lx,
      y1,
      lz,
      withBlockProperties(archStair, { facing: ns ? 'west' : 'north', half: 'top' }),
      null,
    );
    ctx.put(
      rx,
      y1,
      rz,
      withBlockProperties(archStair, { facing: ns ? 'east' : 'south', half: 'top' }),
      null,
    );
  }
  emitArcadeGalleryLintel(ctx, u0, u1, y1 + 1, spec.lintel);
};

const isInsideAnyRoom = (
  rooms: ReadonlyMap<string, StructureRoomMeta>,
  x: number,
  y: number,
  z: number,
): boolean => {
  for (const r of rooms.values()) {
    if (
      x > r.from[0] &&
      x < r.to[0] &&
      y > r.from[1] &&
      y < r.to[1] &&
      z > r.from[2] &&
      z < r.to[2] &&
      !(r.shape === 'octagon' && isOctagonOutside(x, z, r.from, r.to))
    ) {
      return true;
    }
  }
  return false;
};

export const canPlaceRoofCell = (
  roofMaxY: Int16Array,
  voxels: Int32Array,
  size: IntVec3,
  rooms: ReadonlyMap<string, StructureRoomMeta>,
  [x, y, z]: IntVec3,
  kind: 'roof' | 'gable',
): boolean => {
  const [w, h, d] = size;
  if (x < 0 || x >= w || y < 0 || y >= h || z < 0 || z >= d) return true;
  const prev = roofMaxY[z * w + x]!;
  if (kind === 'gable') {
    if (prev >= y) return false;
    return !isInsideAnyRoom(rooms, x, y, z);
  }
  if (prev > y) return false;
  if (prev === y && voxels[(y * d + z) * w + x]! > 0) return false;
  return true;
};

export const recordRoofMaxY = (
  roofMaxY: Int16Array,
  size: IntVec3,
  cells: readonly IntVec3[],
): void => {
  const [w, _h, d] = size;
  for (const [x, y, z] of cells) {
    if (x < 0 || x >= w || z < 0 || z >= d) continue;
    const col = z * w + x;
    if (y > roofMaxY[col]!) roofMaxY[col] = y;
  }
};
