import {
  StructureInputError,
  type BlockRotation,
  type IntVec3,
  type MirrorAxis,
  type StructureOp,
  type StructureSourceUnit,
  type WeatheringRule,
} from '../../project/structure/contract';
import type { InteriorRoomOp } from '../../project/structure/interiorDef';
import {
  formatBlockState,
  mirrorBlockState,
  parseBlockState,
  rotateBlockState,
} from '../../project/structure/state';
import type {
  CompoundChildPlacement,
  EvaluatedStructureResult,
  StructureFloorMeta,
  StructureOpeningMeta,
  StructureRoomMeta,
  StructureSocketMeta,
} from './contract';

export interface EvalState {
  readonly rootPath: string;
  readonly units: ReadonlyMap<string, StructureSourceUnit>;
  readonly relative: (owner: string, specifier: string) => string;
  readonly evaluatedGridCache?: Map<string, EvaluatedStructureResult>;
  readonly compoundChildren: CompoundChildPlacement[];
  readonly seed: number;
  readonly size: IntVec3;
  readonly voxels: Int32Array;
  readonly customTags: (string | null)[];
  readonly protectedAir: Uint8Array;
  readonly stateToIdx: Map<string, number>;
  readonly states: string[];
  readonly usedImports: Map<string, Set<string>>;
  readonly usedPaletteKeys: Map<string, Set<string>>;
  readonly usedPrefabs: Map<string, Set<string>>;
  readonly floors: StructureFloorMeta[];
  readonly floorNames: Set<string>;
  readonly rooms: Map<string, StructureRoomMeta>;
  readonly openings: StructureOpeningMeta[];
  readonly sockets: StructureSocketMeta[];
  readonly socketIds: Set<string>;
  readonly roofCells: IntVec3[];
  readonly chimneyTops: IntVec3[];
  readonly interiorSpecs: { readonly ownerPath: string; readonly op: InteriorRoomOp }[];
  currentFloor: StructureFloorMeta | null;
  hasRoofTrim: boolean;
  roofCount: number;
  dormerCount: number;
  chimneyCount: number;
  opCount: number;
  prefabUses: number;
  readonly stats: {
    roomCount: number;
    facadeCount: number;
    stairCount: number;
    furnishCount: number;
    weatheringCount: number;
    rawSetCount: number;
  };
}

export const failEval = (file: string, code: string, message: string): never => {
  throw new StructureInputError({
    code,
    file,
    pointer: 'build',
    expected: 'valid structure operation',
    actual: message,
  });
};

export const createEvalState = (
  rootPath: string,
  units: ReadonlyMap<string, StructureSourceUnit>,
  relative: (owner: string, specifier: string) => string,
  evaluatedGridCache?: Map<string, EvaluatedStructureResult>,
): EvalState => {
  const root = units.get(rootPath)!;
  const size = root.size!;
  const volume = size[0] * size[1] * size[2];
  return {
    rootPath,
    units,
    relative,
    evaluatedGridCache,
    compoundChildren: [],
    seed: root.seed,
    size,
    voxels: new Int32Array(volume).fill(-1),
    customTags: new Array<string | null>(volume).fill(null),
    protectedAir: new Uint8Array(volume),
    stateToIdx: new Map([['minecraft:air', 0]]),
    states: ['minecraft:air'],
    usedImports: new Map([...units.keys()].map((k) => [k, new Set<string>()])),
    usedPaletteKeys: new Map([...units.keys()].map((k) => [k, new Set<string>()])),
    usedPrefabs: new Map([...units.keys()].map((k) => [k, new Set<string>()])),
    floors: [],
    floorNames: new Set(),
    rooms: new Map(),
    openings: [],
    sockets: [],
    socketIds: new Set(),
    roofCells: [],
    chimneyTops: [],
    interiorSpecs: [],
    currentFloor: null,
    hasRoofTrim: false,
    roofCount: 0,
    dormerCount: 0,
    chimneyCount: 0,
    opCount: 0,
    prefabUses: 0,
    stats: {
      roomCount: 0,
      facadeCount: 0,
      stairCount: 0,
      furnishCount: 0,
      weatheringCount: 0,
      rawSetCount: 0,
    },
  };
};

export interface WeatheringContext {
  readonly seed: number;
  readonly size: IntVec3;
  readonly voxels: Int32Array;
  readonly states: readonly string[];
  readonly rooms: readonly StructureRoomMeta[];
  readonly roofCells: readonly IntVec3[];
  readonly chimneyTops: readonly IntVec3[];
  readonly ownerPath: string;
  readonly resolve: (
    keyOrState: string,
    ownerPath: string,
    pos: IntVec3,
  ) => { readonly state: string; readonly assetAlias: string | null };
  readonly put: (x: number, y: number, z: number, state: string, assetAlias: string | null) => void;
}

export const seededNoise = (seed: number, x: number, y: number, z: number): number => {
  let h =
    (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export const pickWeightedState = (
  entries: readonly { readonly state: string; readonly weight: number }[],
  seed: number,
  pos: IntVec3,
): string => {
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  let target = seededNoise(seed, pos[0], pos[1], pos[2]) * total;
  for (const entry of entries) {
    target -= entry.weight;
    if (target <= 0) return entry.state;
  }
  return entries[entries.length - 1]!.state;
};

const matchesBlock = (actualState: string, targetState: string): boolean =>
  parseBlockState(actualState).name === parseBlockState(targetState).name;

const replacePreservingProps = (actualState: string, intoState: string): string => {
  const a = parseBlockState(actualState);
  const b = parseBlockState(intoState);
  if (Object.keys(b.properties).length > 0) return intoState;
  return formatBlockState({ name: b.name, properties: a.properties });
};

const MOSSABLE_PLINTH_BLOCKS: ReadonlySet<string> = new Set([
  'minecraft:cobblestone',
  'minecraft:stone_bricks',
  'minecraft:cracked_stone_bricks',
  'minecraft:stone',
  'minecraft:deepslate_bricks',
]);

const tryReplaceVoxel = (
  ctx: WeatheringContext,
  x: number,
  y: number,
  z: number,
  target: string,
  intoKey: string,
  prob: number,
  salt: number,
): void => {
  const [w, _h, d] = ctx.size;
  const v = ctx.voxels[(y * d + z) * w + x]!;
  if (v <= 0) return;
  const cur = ctx.states[v]!;
  if (!matchesBlock(cur, target)) return;
  if (!MOSSABLE_PLINTH_BLOCKS.has(parseBlockState(cur).name)) return;
  if (seededNoise(ctx.seed + salt, x, y, z) < prob) {
    const into = ctx.resolve(intoKey, ctx.ownerPath, [x, y, z]);
    ctx.put(x, y, z, replacePreservingProps(cur, into.state), into.assetAlias);
  }
};

const applyGroundMoss = (
  ctx: WeatheringContext,
  rule: Extract<WeatheringRule, { kind: 'ground_moss' }>,
): void => {
  const [w, h, d] = ctx.size;
  const target = ctx.resolve(rule.target, ctx.ownerPath, [0, 0, 0]).state;
  ctx.resolve(rule.into, ctx.ownerPath, [0, 0, 0]);
  const maxY = Math.min(h - 1, rule.height);
  for (let y = 0; y <= maxY; y += 1) {
    const prob = rule.rate * (1 - y / (rule.height + 1));
    for (let z = 0; z < d; z += 1) {
      for (let x = 0; x < w; x += 1) {
        tryReplaceVoxel(ctx, x, y, z, target, rule.into, prob, 11);
      }
    }
  }
};

const applyCornerQuoin = (
  ctx: WeatheringContext,
  rule: Extract<WeatheringRule, { kind: 'corner_quoin' }>,
): void => {
  const [w, _h, d] = ctx.size;
  const target = ctx.resolve(rule.target, ctx.ownerPath, [0, 0, 0]).state;
  ctx.resolve(rule.corners, ctx.ownerPath, [0, 0, 0]);
  for (const room of ctx.rooms) {
    const corners: readonly [number, number][] = [
      [room.from[0], room.from[2]],
      [room.to[0], room.from[2]],
      [room.from[0], room.to[2]],
      [room.to[0], room.to[2]],
    ];
    for (const [cx, cz] of corners) {
      for (let y = room.from[1]; y <= room.to[1]; y += 2) {
        const v = ctx.voxels[(y * d + cz) * w + cx]!;
        if (v <= 0 || !matchesBlock(ctx.states[v]!, target)) continue;
        const rep = ctx.resolve(rule.corners, ctx.ownerPath, [cx, y, cz]);
        ctx.put(cx, y, cz, rep.state, rep.assetAlias);
      }
    }
  }
};

const trySootCell = (
  ctx: WeatheringContext,
  x: number,
  y: number,
  z: number,
  rate: number,
): void => {
  const [w, h, d] = ctx.size;
  if (x < 0 || x >= w || y < 0 || y >= h || z < 0 || z >= d) return;
  const v = ctx.voxels[(y * d + z) * w + x]!;
  if (v <= 0) return;
  const name = parseBlockState(ctx.states[v]!).name;
  if (!name.includes('bricks') && !name.includes('cobblestone')) return;
  if (seededNoise(ctx.seed + 37, x, y, z) < rate)
    ctx.put(x, y, z, 'minecraft:deepslate_bricks', null);
};

const applyChimneySoot = (
  ctx: WeatheringContext,
  rule: Extract<WeatheringRule, { kind: 'chimney_soot' }>,
): void => {
  for (const [tx, ty, tz] of ctx.chimneyTops) {
    for (let dy = -rule.radius; dy <= 1; dy += 1) {
      for (let dz = -rule.radius; dz <= rule.radius; dz += 1) {
        for (let dx = -rule.radius; dx <= rule.radius; dx += 1) {
          trySootCell(ctx, tx + dx, ty + dy, tz + dz, rule.rate);
        }
      }
    }
  }
};

const applyEaveShadow = (
  ctx: WeatheringContext,
  rule: Extract<WeatheringRule, { kind: 'eave_shadow' }>,
): void => {
  ctx.resolve(rule.target, ctx.ownerPath, [0, 0, 0]);
  ctx.resolve(rule.into, ctx.ownerPath, [0, 0, 0]);
};

export const applyWeatheringRules = (
  ctx: WeatheringContext,
  rules: readonly WeatheringRule[],
): void => {
  for (const rule of rules) {
    if (rule.kind === 'ground_moss') applyGroundMoss(ctx, rule);
    else if (rule.kind === 'corner_quoin') applyCornerQuoin(ctx, rule);
    else if (rule.kind === 'chimney_soot') applyChimneySoot(ctx, rule);
    else applyEaveShadow(ctx, rule);
  }
};

export interface FrameTransform {
  readonly offset: IntVec3;
  readonly rotate: BlockRotation;
  readonly mirrorX: boolean;
}

export const IDENTITY_FRAME: FrameTransform = {
  offset: [0, 0, 0],
  rotate: 0,
  mirrorX: false,
};

export const rotatePt = ([x, y, z]: IntVec3, rotate: BlockRotation): IntVec3 =>
  rotate === 90
    ? [-z, y, x]
    : rotate === 180
      ? [-x, y, -z]
      : rotate === 270
        ? [z, y, -x]
        : [x, y, z];

export const applyLinear = ([x, y, z]: IntVec3, frame: FrameTransform): IntVec3 =>
  rotatePt(frame.mirrorX ? [-x, y, z] : [x, y, z], frame.rotate);

export const applyFrameScalars = (
  x: number,
  y: number,
  z: number,
  frame: FrameTransform,
): IntVec3 => {
  const mx = frame.mirrorX ? -x : x;
  const [ox, oy, oz] = frame.offset;
  if (frame.rotate === 90) return [-z + ox, y + oy, mx + oz];
  if (frame.rotate === 180) return [-mx + ox, y + oy, -z + oz];
  if (frame.rotate === 270) return [z + ox, y + oy, -mx + oz];
  return [mx + ox, y + oy, z + oz];
};

export const applyFrame = (pt: IntVec3, frame: FrameTransform): IntVec3 =>
  applyFrameScalars(pt[0], pt[1], pt[2], frame);

export const transformBlockState = (rawState: string, frame: FrameTransform): string =>
  rotateBlockState(frame.mirrorX ? mirrorBlockState(rawState, 'x') : rawState, frame.rotate);

export const composeFrames = (outer: FrameTransform, inner: FrameTransform): FrameTransform => {
  const [rx, ry, rz] = applyLinear(inner.offset, outer);
  const rawRotate = outer.mirrorX ? outer.rotate - inner.rotate : outer.rotate + inner.rotate;
  return {
    offset: [outer.offset[0] + rx, outer.offset[1] + ry, outer.offset[2] + rz],
    rotate: (((rawRotate % 360) + 360) % 360) as BlockRotation,
    mirrorX: outer.mirrorX !== inner.mirrorX,
  };
};

export const stepOffset = (axis: 'x' | 'y' | 'z', delta: number): IntVec3 =>
  axis === 'x' ? [delta, 0, 0] : axis === 'y' ? [0, delta, 0] : [0, 0, delta];

export const mirrorFrame = (axis: MirrorAxis, center: number): FrameTransform =>
  axis === 'x'
    ? { offset: [center * 2, 0, 0], rotate: 0, mirrorX: true }
    : { offset: [0, 0, center * 2], rotate: 180, mirrorX: true };

const regionAccepts = (
  kind: string,
  x: number,
  y: number,
  z: number,
  min: IntVec3,
  max: IntVec3,
): boolean => {
  if (kind === 'box' || kind === 'carve') return true;
  const onX = x === min[0] || x === max[0];
  const onY = y === min[1] || y === max[1];
  const onZ = z === min[2] || z === max[2];
  if (kind === 'hollow') return onX || onY || onZ;
  if (kind === 'walls') return onX || onZ;
  return (onX && onY) || (onY && onZ) || (onX && onZ);
};

const makeStateTransformer = (frame: FrameTransform): ((raw: string) => string) => {
  const cache = new Map<string, string>();
  return (raw: string): string => {
    let tx = cache.get(raw);
    if (tx === undefined) {
      tx = transformBlockState(raw, frame);
      cache.set(raw, tx);
    }
    return tx;
  };
};

type RegionOp = Extract<StructureOp, { op: 'box' | 'hollow' | 'walls' | 'frame' | 'carve' }>;
type RegionResolve = (
  key: string,
  owner: string,
  pos: IntVec3,
) => { readonly state: string; readonly assetAlias: string | null };
type RegionPut = (pos: IntVec3, state: string, alias: string | null) => void;

const emitRegionCell = (
  op: RegionOp,
  worldPos: IntVec3,
  ownerPath: string,
  staticRes: {
    readonly state: string;
    readonly assetAlias: string | null;
  } | null,
  staticState: string,
  txState: (raw: string) => string,
  resolve: RegionResolve,
  put: RegionPut,
): void => {
  if (op.op === 'carve') {
    put(worldPos, 'minecraft:air', null);
    return;
  }
  if (staticRes) {
    put(worldPos, staticState, staticRes.assetAlias);
    return;
  }
  const res = resolve(op.block, ownerPath, worldPos);
  put(worldPos, txState(res.state), res.assetAlias);
};

export const emitRegionOp = (
  op: RegionOp,
  fMin: IntVec3,
  fMax: IntVec3,
  frame: FrameTransform,
  ownerPath: string,
  resolve: RegionResolve,
  put: RegionPut,
  isStatic?: boolean,
): void => {
  const min: IntVec3 = [
    Math.min(fMin[0], fMax[0]),
    Math.min(fMin[1], fMax[1]),
    Math.min(fMin[2], fMax[2]),
  ];
  const max: IntVec3 = [
    Math.max(fMin[0], fMax[0]),
    Math.max(fMin[1], fMax[1]),
    Math.max(fMin[2], fMax[2]),
  ];
  const txState = makeStateTransformer(frame);
  const staticRes = op.op !== 'carve' && isStatic ? resolve(op.block, ownerPath, min) : null;
  const staticState = staticRes ? txState(staticRes.state) : '';
  for (let y = min[1]; y <= max[1]; y += 1) {
    for (let z = min[2]; z <= max[2]; z += 1) {
      for (let x = min[0]; x <= max[0]; x += 1) {
        if (!regionAccepts(op.op, x, y, z, min, max)) continue;
        const worldPos = applyFrameScalars(x, y, z, frame);
        emitRegionCell(op, worldPos, ownerPath, staticRes, staticState, txState, resolve, put);
      }
    }
  }
};

export const emitLayerOp = (
  op: Extract<StructureOp, { op: 'layer' }>,
  ox: number,
  oz: number,
  ly: number,
  frame: FrameTransform,
  ownerPath: string,
  resolve: RegionResolve,
  put: RegionPut,
  fail: (code: string, msg: string) => never,
): void => {
  const txState = makeStateTransformer(frame);
  for (let r = 0; r < op.rows.length; r += 1) {
    const row = op.rows[r]!;
    for (let c = 0; c < row.length; c += 1) {
      const ch = row[c]!;
      if (ch === '.' || ch === ' ') continue;
      const key = op.map[ch];
      if (!key) fail('structure.unknown-layer-key', `Unmapped layer char "${ch}"`);
      const pos = applyFrameScalars(ox + c, ly, oz + r, frame);
      const res = resolve(key!, ownerPath, pos);
      put(pos, txState(res.state), res.assetAlias);
    }
  }
};
