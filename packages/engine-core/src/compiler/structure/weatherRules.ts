import type { IntVec3, WeatheringRule } from '../../project/structure/contract';
import type { StructureRoomMeta } from './contract';
import {
  findExteriorOutward,
  hasAdjacentSolid,
  hasExposedCardinal,
  isCustomTagged,
  isInsideAnyRoom,
  isNearOpening,
  isProtectedAir,
  isSingleComponentWithout,
  matchesOptionalTarget,
  replaceWithPreservedProps,
  scanCells,
  seededNoise,
  voxelAt,
  type WeatheringContext,
} from './weatherCtx';

type ExtraWeatheringRule = Extract<
  WeatheringRule,
  { kind: 'rust_streak' | 'wall_breach' | 'shattered_glass' | 'vine_overgrowth' }
>;

const RUSTABLE_TOKENS =
  'iron_block,copper,concrete,smooth_stone,deepslate,stone_bricks,bricks,terracotta,quartz,andesite'.split(
    ',',
  );

const EXCLUDED_WALL_TOKENS =
  'door,bars,glass,stair,slab,lantern,torch,fence,wall,ladder,chest,bed,furnace,pressure_plate,carpet'.split(
    ',',
  );

const isRustableBlockName = (name: string): boolean =>
  !EXCLUDED_WALL_TOKENS.some((t) => name.includes(t)) &&
  RUSTABLE_TOKENS.some((t) => name.includes(t));

const isBreachableWallName = (name: string): boolean =>
  !EXCLUDED_WALL_TOKENS.some((t) => name.includes(t)) && !name.includes('leaves');

const isGlassName = (name: string): boolean => name.includes('glass');

const dripRustDown = (
  ctx: WeatheringContext,
  x: number,
  startY: number,
  z: number,
  targetState: string | null,
  intoKey: string,
  len: number,
): void => {
  for (let dy = 0; dy < len && startY - dy >= 1; dy += 1) {
    const cy = startY - dy;
    const cv = voxelAt(ctx, x, cy, z);
    if (cv <= 0 || isCustomTagged(ctx, x, cy, z) || !hasExposedCardinal(ctx, x, cy, z)) break;
    const curState = ctx.states[cv]!;
    if (!matchesOptionalTarget(curState, targetState, isRustableBlockName)) break;
    const resolved = ctx.resolve(intoKey, ctx.ownerPath, [x, cy, z]);
    ctx.put(x, cy, z, replaceWithPreservedProps(curState, resolved.state), resolved.assetAlias);
  }
};

const applyRustColumn = (
  ctx: WeatheringContext,
  x: number,
  z: number,
  targetState: string | null,
  intoKey: string,
  rule: Extract<ExtraWeatheringRule, { kind: 'rust_streak' }>,
): void => {
  const [, h] = ctx.size;
  for (let y = h - 1; y >= 1; y -= 1) {
    const v = voxelAt(ctx, x, y, z);
    if (v <= 0 || isCustomTagged(ctx, x, y, z) || !hasExposedCardinal(ctx, x, y, z)) continue;
    if (!matchesOptionalTarget(ctx.states[v]!, targetState, isRustableBlockName)) continue;
    const above = voxelAt(ctx, x, y + 1, z);
    const triggerChance = above <= 0 || above !== v ? rule.rate : rule.rate * 0.35;
    if (seededNoise(ctx.seed + 53, x, y, z) >= triggerChance) continue;
    const len = 1 + Math.floor(seededNoise(ctx.seed + 59, x, y, z) * rule.length);
    dripRustDown(ctx, x, y, z, targetState, intoKey, len);
  }
};

const applyRustStreak = (
  ctx: WeatheringContext,
  rule: Extract<ExtraWeatheringRule, { kind: 'rust_streak' }>,
): void => {
  const [w, , d] = ctx.size;
  const targetState = rule.target ? ctx.resolve(rule.target, ctx.ownerPath, [0, 0, 0]).state : null;
  const intoKey = rule.into ?? 'minecraft:exposed_copper';
  ctx.resolve(intoKey, ctx.ownerPath, [0, 0, 0]);
  for (let z = 0; z < d; z += 1) {
    for (let x = 0; x < w; x += 1) applyRustColumn(ctx, x, z, targetState, intoKey, rule);
  }
};

const roomTouchesProtected = (r: StructureRoomMeta, x: number, y: number, z: number): boolean => {
  if (x < r.from[0] || x > r.to[0] || z < r.from[2] || z > r.to[2]) return false;
  if (y <= r.from[1] || y >= r.to[1]) return true;
  const onX = x === r.from[0] || x === r.to[0];
  const onZ = z === r.from[2] || z === r.to[2];
  const nearCornerX = Math.abs(x - r.from[0]) <= 1 || Math.abs(x - r.to[0]) <= 1;
  const nearCornerZ = Math.abs(z - r.from[2]) <= 1 || Math.abs(z - r.to[2]) <= 1;
  return (onX && onZ) || (onX && nearCornerZ) || (onZ && nearCornerX);
};

const canBreachCell = (
  ctx: WeatheringContext,
  x: number,
  y: number,
  z: number,
  targetState: string | null,
): boolean => {
  const [w, h, d] = ctx.size;
  if (x < 0 || x >= w || y < 1 || y >= h - 1 || z < 0 || z >= d) return false;
  const v = voxelAt(ctx, x, y, z);
  if (v <= 0 || isCustomTagged(ctx, x, y, z)) return false;
  if (
    isNearOpening(ctx.openings, x, y, z, 1) ||
    ctx.rooms.some((r) => roomTouchesProtected(r, x, y, z))
  ) {
    return false;
  }
  return matchesOptionalTarget(ctx.states[v]!, targetState, isBreachableWallName);
};

const placeBreachRubble = (
  ctx: WeatheringContext,
  bx: number,
  bz: number,
  outDir: readonly [number, number],
  rubbleKey: string,
): void => {
  const [w, , d] = ctx.size;
  const rx = bx + outDir[0];
  const rz = bz + outDir[1];
  if (rx < 0 || rx >= w || rz < 0 || rz >= d) return;
  if (isInsideAnyRoom(ctx.rooms, rx, 1, rz) || isNearOpening(ctx.openings, rx, 1, rz, 1)) return;
  if (voxelAt(ctx, rx, 0, rz) <= 0) {
    if (hasAdjacentSolid(ctx, rx, 0, rz) && !isProtectedAir(ctx, rx, 0, rz)) {
      const res = ctx.resolve('minecraft:cobblestone', ctx.ownerPath, [rx, 0, rz]);
      ctx.put(rx, 0, rz, res.state, res.assetAlias);
    }
    return;
  }
  if (voxelAt(ctx, rx, 1, rz) <= 0 && !isProtectedAir(ctx, rx, 1, rz)) {
    const res = ctx.resolve(rubbleKey, ctx.ownerPath, [rx, 1, rz]);
    ctx.put(rx, 1, rz, res.state, res.assetAlias);
  }
};

const tryCarveBreachPatch = (
  ctx: WeatheringContext,
  x: number,
  y: number,
  z: number,
  targetState: string | null,
  rubbleKey: string,
  rule: Extract<ExtraWeatheringRule, { kind: 'wall_breach' }>,
): boolean => {
  const outDir = findExteriorOutward(ctx, x, y, z);
  if (!outDir) return false;
  const [w, , d] = ctx.size;
  const spanX = outDir[0] === 0;
  const bw = 1 + Math.floor(seededNoise(ctx.seed + 67, x, y, z) * rule.maxWidth);
  const bh = 1 + Math.floor(seededNoise(ctx.seed + 71, x, y, z) * rule.height);
  const cells: IntVec3[] = [];
  const indices = new Set<number>();
  for (let dy = 0; dy < bh; dy += 1) {
    for (let du = 0; du < bw; du += 1) {
      const cx = spanX ? x + du : x;
      const cz = spanX ? z : z + du;
      const cy = y + dy;
      if (!canBreachCell(ctx, cx, cy, cz, targetState)) return false;
      cells.push([cx, cy, cz]);
      indices.add((cy * d + cz) * w + cx);
    }
  }
  if (!isSingleComponentWithout(ctx, indices)) return false;
  for (const [cx, cy, cz] of cells) ctx.put(cx, cy, cz, 'minecraft:air', null);
  placeBreachRubble(ctx, x, z, outDir, rubbleKey);
  return true;
};

const stepSingleBreach = (
  ctx: WeatheringContext,
  x: number,
  y: number,
  z: number,
  targetState: string | null,
  rubbleKey: string,
  rule: Extract<ExtraWeatheringRule, { kind: 'wall_breach' }>,
): void => {
  if (!canBreachCell(ctx, x, y, z, targetState)) return;
  if (seededNoise(ctx.seed + 61, x, y, z) >= rule.rate * 0.35) return;
  tryCarveBreachPatch(ctx, x, y, z, targetState, rubbleKey, rule);
};

const applyWallBreach = (
  ctx: WeatheringContext,
  rule: Extract<ExtraWeatheringRule, { kind: 'wall_breach' }>,
): void => {
  const targetState = rule.target ? ctx.resolve(rule.target, ctx.ownerPath, [0, 0, 0]).state : null;
  const rubbleKey = rule.rubble ?? 'minecraft:cobblestone_slab[type=bottom]';
  ctx.resolve(rubbleKey, ctx.ownerPath, [0, 0, 0]);
  scanCells(ctx.size, 1, ctx.size[1] - 2, 2, 2, (x, y, z) =>
    stepSingleBreach(ctx, x, y, z, targetState, rubbleKey, rule),
  );
};

const stepShatterCell = (
  ctx: WeatheringContext,
  x: number,
  y: number,
  z: number,
  targetState: string | null,
  rule: Extract<ExtraWeatheringRule, { kind: 'shattered_glass' }>,
): void => {
  const [w, , d] = ctx.size;
  const v = voxelAt(ctx, x, y, z);
  if (v <= 0 || isCustomTagged(ctx, x, y, z)) return;
  if (!matchesOptionalTarget(ctx.states[v]!, targetState, isGlassName)) return;
  const roll = seededNoise(ctx.seed + 73, x, y, z);
  if (roll >= rule.rate) return;
  const idx = (y * d + z) * w + x;
  if (roll < rule.rate * 0.7 && isSingleComponentWithout(ctx, new Set([idx]))) {
    ctx.put(x, y, z, 'minecraft:air', null);
    const outDir = findExteriorOutward(ctx, x, y, z);
    if (outDir && rule.shard) placeBreachRubble(ctx, x, z, outDir, rule.shard);
    return;
  }
  if (rule.shard) {
    const res = ctx.resolve(rule.shard, ctx.ownerPath, [x, y, z]);
    ctx.put(x, y, z, replaceWithPreservedProps(ctx.states[v]!, res.state), res.assetAlias);
  }
};

const applyShatteredGlass = (
  ctx: WeatheringContext,
  rule: Extract<ExtraWeatheringRule, { kind: 'shattered_glass' }>,
): void => {
  const targetState = rule.target ? ctx.resolve(rule.target, ctx.ownerPath, [0, 0, 0]).state : null;
  if (rule.shard) ctx.resolve(rule.shard, ctx.ownerPath, [0, 0, 0]);
  scanCells(ctx.size, 1, ctx.size[1] - 2, 1, 1, (x, y, z) =>
    stepShatterCell(ctx, x, y, z, targetState, rule),
  );
};

const growVineStrand = (
  ctx: WeatheringContext,
  vx: number,
  startY: number,
  vz: number,
  intoKey: string,
  maxLen: number,
): void => {
  for (let dy = 0; dy < maxLen && startY - dy >= 1; dy += 1) {
    const cy = startY - dy;
    if (voxelAt(ctx, vx, cy, vz) > 0 || isProtectedAir(ctx, vx, cy, vz)) break;
    if (isInsideAnyRoom(ctx.rooms, vx, cy, vz) || isNearOpening(ctx.openings, vx, cy, vz, 1)) break;
    if (!hasAdjacentSolid(ctx, vx, cy, vz)) break;
    const res = ctx.resolve(intoKey, ctx.ownerPath, [vx, cy, vz]);
    ctx.put(vx, cy, vz, res.state, res.assetAlias);
  }
};

const stepVineCell = (
  ctx: WeatheringContext,
  x: number,
  y: number,
  z: number,
  targetState: string | null,
  intoKey: string,
  rule: Extract<ExtraWeatheringRule, { kind: 'vine_overgrowth' }>,
): void => {
  const v = voxelAt(ctx, x, y, z);
  if (v <= 0 || isCustomTagged(ctx, x, y, z)) return;
  if (!matchesOptionalTarget(ctx.states[v]!, targetState, isBreachableWallName)) return;
  if (seededNoise(ctx.seed + 83, x, y, z) >= rule.rate * 0.45) return;
  const outDir = findExteriorOutward(ctx, x, y, z);
  if (!outDir) return;
  const len = 1 + Math.floor(seededNoise(ctx.seed + 89, x, y, z) * rule.height);
  growVineStrand(ctx, x + outDir[0], y, z + outDir[1], intoKey, len);
};

const applyVineOvergrowth = (
  ctx: WeatheringContext,
  rule: Extract<ExtraWeatheringRule, { kind: 'vine_overgrowth' }>,
): void => {
  const targetState = rule.target ? ctx.resolve(rule.target, ctx.ownerPath, [0, 0, 0]).state : null;
  const intoKey = rule.into ?? 'minecraft:oak_leaves[persistent=true]';
  ctx.resolve(intoKey, ctx.ownerPath, [0, 0, 0]);
  scanCells(ctx.size, 2, ctx.size[1] - 2, 1, 1, (x, y, z) =>
    stepVineCell(ctx, x, y, z, targetState, intoKey, rule),
  );
};

/** Evaluates non-medieval weathering rules (`rust_streak`, `wall_breach`, `shattered_glass`, `vine_overgrowth`). */
export const applyExtraWeatheringRule = (
  ctx: WeatheringContext,
  rule: ExtraWeatheringRule,
): void => {
  if (rule.kind === 'rust_streak') applyRustStreak(ctx, rule);
  else if (rule.kind === 'wall_breach') applyWallBreach(ctx, rule);
  else if (rule.kind === 'shattered_glass') applyShatteredGlass(ctx, rule);
  else applyVineOvergrowth(ctx, rule);
};
