import type { CompiledModel } from '../../model/compiled';
import type { CubeFaceDirection } from '../../model/scene';
import type { IntVec3 } from '../../project/structure/contract';
import type { BlockDescriptor } from './blocks';
import type { PlayableLight, StructureGrid, StructureLightingField } from './contract';
import { applyInteriorRadiosityBounce } from './interior/applyBounce';
import {
  faceAo4,
  isWindowInteriorFacing,
  linearToSrgb,
  quantizeFaceTint,
  sampleVertexWeather,
  writeVertexShade,
  type VertexWeatherSample,
} from './vertexWeather';

export { isWindowInteriorFacing };

export interface FaceBasis {
  readonly normal: IntVec3;
  readonly uAxis: IntVec3;
  readonly vAxis: IntVec3;
  readonly shade: number;
}

export const FACE_BASIS: Readonly<Record<CubeFaceDirection, FaceBasis>> = {
  north: {
    normal: [0, 0, -1],
    uAxis: [-1, 0, 0],
    vAxis: [0, 1, 0],
    shade: 0.88,
  },
  south: { normal: [0, 0, 1], uAxis: [1, 0, 0], vAxis: [0, 1, 0], shade: 0.88 },
  east: { normal: [1, 0, 0], uAxis: [0, 0, -1], vAxis: [0, 1, 0], shade: 0.8 },
  west: { normal: [-1, 0, 0], uAxis: [0, 0, 1], vAxis: [0, 1, 0], shade: 0.8 },
  up: { normal: [0, 1, 0], uAxis: [1, 0, 0], vAxis: [0, 0, -1], shade: 1.0 },
  down: { normal: [0, -1, 0], uAxis: [1, 0, 0], vAxis: [0, 0, 1], shade: 0.64 },
};

const DIRS6: readonly IntVec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

interface EmissiveProfile {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly kind: PlayableLight['kind'];
  readonly color: string;
  readonly intensity: number;
  readonly radius: number;
}

const profile = (
  r: number,
  g: number,
  b: number,
  kind: PlayableLight['kind'],
  color: string,
  intensity: number,
  radius: number,
): EmissiveProfile => ({ r, g, b, kind, color, intensity, radius });

const PROFILES = {
  soul: profile(120, 235, 255, 'soul_lantern', '#78ebff', 1.15, 7),
  rune: profile(110, 230, 245, 'emissive_prop', '#6ee6f5', 0.95, 6),
  lantern: profile(255, 208, 128, 'lantern', '#ffd080', 1.2, 8),
  hearth: profile(255, 165, 85, 'hearth', '#ffa555', 1.35, 9),
  furnace: profile(255, 150, 75, 'hearth', '#ff964b', 0.95, 6),
  torch: profile(255, 195, 110, 'torch', '#ffc36e', 0.95, 6),
} as const satisfies Record<string, EmissiveProfile>;

const STATE_PROFILE_RULES: readonly [string, EmissiveProfile][] = [
  ['soul_lantern', PROFILES.soul],
  ['sea_lantern', PROFILES.soul],
  ['campfire', PROFILES.hearth],
  ['furnace', PROFILES.furnace],
  ['torch', PROFILES.torch],
];

const emissiveProfileForTag = (tag: string, desc: BlockDescriptor): EmissiveProfile | null => {
  if (tag.includes('soul')) return PROFILES.soul;
  if (tag.includes('rune')) return PROFILES.rune;
  if (tag.includes('lantern') || tag.includes('lamp') || desc.light) return PROFILES.lantern;
  return null;
};

const collectEmissiveAliases = (
  customModels: Readonly<Record<string, CompiledModel>>,
): ReadonlySet<string> => {
  const aliases = new Set<string>();
  for (const [alias, model] of Object.entries(customModels)) {
    for (const tex of Object.values(model.textures)) {
      if (tex.renderMode === 'emissive') {
        aliases.add(alias);
        break;
      }
    }
  }
  return aliases;
};

const precomputeStateProfiles = (
  states: readonly string[],
  descs: readonly BlockDescriptor[],
): readonly (EmissiveProfile | null)[] =>
  states.map((state, v) => {
    if (!descs[v]!.light) return null;
    return STATE_PROFILE_RULES.find(([key]) => state.includes(key))?.[1] ?? PROFILES.lantern;
  });

interface RingQueue {
  readonly queue: Int32Array;
  readonly inQueue: Uint8Array;
  head: number;
  tail: number;
  count: number;
}

const createRingQueue = (vol: number): RingQueue => ({
  queue: new Int32Array(vol),
  inQueue: new Uint8Array(vol),
  head: 0,
  tail: 0,
  count: 0,
});

const enqueueRing = (ring: RingQueue, idx: number): void => {
  if (ring.inQueue[idx] !== 0) return;
  ring.inQueue[idx] = 1;
  ring.queue[ring.tail] = idx;
  ring.tail = ring.tail + 1 === ring.queue.length ? 0 : ring.tail + 1;
  ring.count += 1;
};

const dequeueRing = (ring: RingQueue): number => {
  const idx = ring.queue[ring.head]!;
  ring.head = ring.head + 1 === ring.queue.length ? 0 : ring.head + 1;
  ring.count -= 1;
  ring.inQueue[idx] = 0;
  return idx;
};

const isPassableAt = (
  grid: StructureGrid,
  descs: readonly BlockDescriptor[],
  x: number,
  y: number,
  z: number,
): boolean => {
  const [w, h, d] = grid.size;
  if (x < 0 || x >= w || y < 0 || y >= h || z < 0 || z >= d) return false;
  const idx = (y * d + z) * w + x;
  return (
    grid.customTags[idx] !== null ||
    grid.voxels[idx]! <= 0 ||
    !descs[grid.voxels[idx]!]!.solidOpaque
  );
};

interface SkyCtx {
  readonly grid: StructureGrid;
  readonly descs: readonly BlockDescriptor[];
  readonly sky: Uint8Array;
  readonly ring: RingQueue;
}

const seedSkyColumn = (ctx: SkyCtx, x: number, z: number): void => {
  const [w, h, d] = ctx.grid.size;
  let light = 255;
  for (let y = h - 1; y >= 0; y -= 1) {
    const idx = (y * d + z) * w + x;
    const v = ctx.grid.voxels[idx]!;
    if (v > 0 && ctx.grid.customTags[idx] === null && ctx.descs[v]!.solidOpaque) break;
    if (v > 0 && ctx.descs[v]!.top === 'leaves') light = Math.max(64, light - 56);
    ctx.sky[idx] = light;
    enqueueRing(ctx.ring, idx);
  }
};

const stepSkyNeighbors = (ctx: SkyCtx, cur: number): void => {
  const [w, _h, d] = ctx.grid.size;
  const curVal = ctx.sky[cur]!;
  if (curVal <= 28) return;
  const x = cur % w;
  const z = Math.floor(cur / w) % d;
  const y = Math.floor(cur / (w * d));
  for (const [dx, dy, dz] of DIRS6) {
    const nx = x + dx;
    const ny = y + dy;
    const nz = z + dz;
    if (!isPassableAt(ctx.grid, ctx.descs, nx, ny, nz)) continue;
    const nextVal = curVal - (dy < 0 ? 16 : 32);
    const nIdx = (ny * d + nz) * w + nx;
    if (nextVal > ctx.sky[nIdx]!) {
      ctx.sky[nIdx] = nextVal;
      enqueueRing(ctx.ring, nIdx);
    }
  }
};

const floodSkyLight = (
  grid: StructureGrid,
  descs: readonly BlockDescriptor[],
  sky: Uint8Array,
  ring: RingQueue,
): void => {
  const [w, _h, d] = grid.size;
  const ctx: SkyCtx = { grid, descs, sky, ring };
  for (let z = 0; z < d; z += 1) for (let x = 0; x < w; x += 1) seedSkyColumn(ctx, x, z);
  while (ring.count > 0) stepSkyNeighbors(ctx, dequeueRing(ring));
};

interface RgbCtx {
  readonly grid: StructureGrid;
  readonly descs: readonly BlockDescriptor[];
  readonly blockR: Uint8Array;
  readonly blockG: Uint8Array;
  readonly blockB: Uint8Array;
  readonly ring: RingQueue;
}

const isWindowState = (state: string, desc: BlockDescriptor): boolean =>
  desc.top === 'glass' || state.includes('glass_pane') || state.includes('minecraft:glass');

const seedCellGlow = (ctx: RgbCtx, idx: number, r: number, g: number, b: number): void => {
  ctx.blockR[idx] = Math.max(ctx.blockR[idx]!, r);
  ctx.blockG[idx] = Math.max(ctx.blockG[idx]!, g);
  ctx.blockB[idx] = Math.max(ctx.blockB[idx]!, b);
  enqueueRing(ctx.ring, idx);
};

const seedBlockLights = (
  ctx: RgbCtx,
  customModels: Readonly<Record<string, CompiledModel>>,
): readonly PlayableLight[] => {
  const [w, h, d] = ctx.grid.size;
  const emissiveAliases = collectEmissiveAliases(customModels);
  const stateProfiles = precomputeStateProfiles(ctx.grid.states, ctx.descs);
  const lights: PlayableLight[] = [];
  for (let idx = 0; idx < w * h * d; idx += 1) {
    const v = ctx.grid.voxels[idx]!;
    if (v <= 0) continue;
    const x = idx % w;
    const z = Math.floor(idx / w) % d;
    const y = Math.floor(idx / (w * d));
    const tag = ctx.grid.customTags[idx]!;
    const active = tag
      ? (emissiveProfileForTag(tag, ctx.descs[v]!) ??
        (emissiveAliases.has(tag) ? PROFILES.rune : null))
      : stateProfiles[v]!;
    if (!active) {
      if (
        !tag &&
        isWindowState(ctx.grid.states[v]!, ctx.descs[v]!) &&
        isWindowInteriorFacing(ctx.grid, x, y, z)
      ) {
        seedCellGlow(ctx, idx, 235, 175, 95);
      }
      continue;
    }
    seedCellGlow(ctx, idx, active.r, active.g, active.b);
    lights.push({
      id: `light_${lights.length}`,
      position: [x - w / 2 + 0.5, y + 0.5, z - d / 2 + 0.5],
      color: active.color,
      intensity: active.intensity,
      radius: active.radius,
      kind: active.kind,
    });
  }
  return lights;
};

const stepRgbNeighbors = (ctx: RgbCtx, cur: number): void => {
  const [w, _h, d] = ctx.grid.size;
  const nr = Math.max(0, ctx.blockR[cur]! - 21);
  const ng = Math.max(0, ctx.blockG[cur]! - 21);
  const nb = Math.max(0, ctx.blockB[cur]! - 21);
  if (nr === 0 && ng === 0 && nb === 0) return;
  const x = cur % w;
  const z = Math.floor(cur / w) % d;
  const y = Math.floor(cur / (w * d));
  for (const [dx, dy, dz] of DIRS6) {
    const nx = x + dx;
    const ny = y + dy;
    const nz = z + dz;
    if (!isPassableAt(ctx.grid, ctx.descs, nx, ny, nz)) continue;
    const nIdx = (ny * d + nz) * w + nx;
    if (nr > ctx.blockR[nIdx]! || ng > ctx.blockG[nIdx]! || nb > ctx.blockB[nIdx]!) {
      ctx.blockR[nIdx] = Math.max(ctx.blockR[nIdx]!, nr);
      ctx.blockG[nIdx] = Math.max(ctx.blockG[nIdx]!, ng);
      ctx.blockB[nIdx] = Math.max(ctx.blockB[nIdx]!, nb);
      enqueueRing(ctx.ring, nIdx);
    }
  }
};

export const computeStructureLighting = (
  grid: StructureGrid,
  descs: readonly BlockDescriptor[],
  customModels: Readonly<Record<string, CompiledModel>> = {},
): {
  readonly lighting: StructureLightingField;
  readonly lights: readonly PlayableLight[];
} => {
  const vol = grid.size[0] * grid.size[1] * grid.size[2];
  const sky = new Uint8Array(vol);
  const blockR = new Uint8Array(vol);
  const blockG = new Uint8Array(vol);
  const blockB = new Uint8Array(vol);
  const ring = createRingQueue(vol);
  floodSkyLight(grid, descs, sky, ring);
  ring.head = 0;
  ring.tail = 0;
  ring.count = 0;
  const ctx: RgbCtx = { grid, descs, blockR, blockG, blockB, ring };
  const lights = seedBlockLights(ctx, customModels);
  while (ring.count > 0) stepRgbNeighbors(ctx, dequeueRing(ring));
  applyInteriorRadiosityBounce(grid, blockR, blockG, blockB);
  return { lighting: { size: grid.size, sky, blockR, blockG, blockB }, lights };
};

const LIGHT_RGB_SCRATCH: [number, number, number] = [1, 1, 1];

const sampleCellLightInto = (
  lighting: StructureLightingField,
  x: number,
  y: number,
  z: number,
  out: [number, number, number],
): void => {
  const size = lighting.size;
  const w = size[0];
  const d = size[2];
  if (x < 0 || x >= w || y >= size[1] || z < 0 || z >= d) {
    out[0] = 1;
    out[1] = 1;
    out[2] = 1;
    return;
  }
  if (y < 0) {
    out[0] = 0.35;
    out[1] = 0.35;
    out[2] = 0.38;
    return;
  }
  const idx = (y * d + z) * w + x;
  const skyLin = (lighting.sky[idx]! / 255) * 0.85 + 0.14;
  const r = skyLin * 0.92 + (lighting.blockR[idx]! / 255) * 1.1;
  const g = skyLin * 0.95 + (lighting.blockG[idx]! / 255) * 1.02;
  const b = skyLin * 1.02 + (lighting.blockB[idx]! / 255) * 0.92;
  out[0] = r <= 0 ? 0 : r >= 1 ? 1 : r;
  out[1] = g <= 0 ? 0 : g >= 1 ? 1 : g;
  out[2] = b <= 0 ? 0 : b >= 1 ? 1 : b;
};

export interface FaceShadeInfo {
  readonly aoCode: number;
  readonly flip: boolean;
  readonly quantizedTint: number;
  readonly colors: readonly number[];
}

export interface MutableFaceShadeInfo {
  aoCode: number;
  flip: boolean;
  quantizedTint: number;
  colors: number[];
}

export const SHARED_FACE_SHADE: MutableFaceShadeInfo = {
  aoCode: 0,
  flip: false,
  quantizedTint: 32767,
  colors: [],
};

const EMISSIVE_FACE_SHADE: FaceShadeInfo = Object.freeze({
  aoCode: 0,
  flip: false,
  quantizedTint: 32767,
  colors: Object.freeze([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
});

const WEATHER_SCRATCH: VertexWeatherSample = { r: 1, g: 1, b: 1, bucket: 0 };

const writeShadeOut = (
  aoCode: number,
  flip: boolean,
  quantizedTint: number,
  colors: number[],
  outShade?: MutableFaceShadeInfo,
): FaceShadeInfo => {
  if (!outShade) return { aoCode, flip, quantizedTint, colors };
  outShade.aoCode = aoCode;
  outShade.flip = flip;
  outShade.quantizedTint = quantizedTint;
  outShade.colors = colors;
  return outShade;
};

export const computeFaceShade = (
  grid: StructureGrid,
  descs: readonly BlockDescriptor[],
  lighting: StructureLightingField,
  x: number,
  y: number,
  z: number,
  dir: CubeFaceDirection,
  isEmissive: boolean,
  maxY: number,
  useSampleCell = true,
  outColors?: number[],
  outShade?: MutableFaceShadeInfo,
): FaceShadeInfo => {
  if (isEmissive) {
    if (!outColors) return EMISSIVE_FACE_SHADE;
    outColors.fill(1, 0, 12);
    return writeShadeOut(0, false, 32767, outColors, outShade);
  }
  const basis = FACE_BASIS[dir];
  const sx = x + basis.normal[0];
  const sy = y + basis.normal[1];
  const sz = z + basis.normal[2];
  const packedAo = faceAo4(grid, descs, sx, sy, sz, basis.uAxis, basis.vAxis, maxY);
  const ao0 = (packedAo >> 12) & 3;
  const ao1 = (packedAo >> 8) & 3;
  const ao2 = (packedAo >> 4) & 3;
  const ao3 = packedAo & 3;
  sampleCellLightInto(
    lighting,
    useSampleCell ? sx : x,
    useSampleCell ? sy : y,
    useSampleCell ? sz : z,
    LIGHT_RGB_SCRATCH,
  );
  sampleVertexWeather(grid, descs, lighting, x, y, z, sx, sy, sz, dir, WEATHER_SCRATCH);
  const fr = LIGHT_RGB_SCRATCH[0] * basis.shade * WEATHER_SCRATCH.r;
  const fg = LIGHT_RGB_SCRATCH[1] * basis.shade * WEATHER_SCRATCH.g;
  const fb = LIGHT_RGB_SCRATCH[2] * basis.shade * WEATHER_SCRATCH.b;
  const colors = outColors ?? new Array<number>(12);
  writeVertexShade(colors, 0, fr, fg, fb, ao0);
  writeVertexShade(colors, 3, fr, fg, fb, ao1);
  writeVertexShade(colors, 6, fr, fg, fb, ao2);
  writeVertexShade(colors, 9, fr, fg, fb, ao3);
  return writeShadeOut(
    (ao0 << 6) | (ao1 << 4) | (ao2 << 2) | ao3,
    ao0 + ao2 > ao1 + ao3,
    quantizeFaceTint(fr, fg, fb, WEATHER_SCRATCH.bucket),
    colors,
    outShade,
  );
};

export const samplePropLightRgb = (
  lighting: StructureLightingField,
  x: number,
  y: number,
  z: number,
): readonly [number, number, number] => {
  sampleCellLightInto(lighting, x, y, z, LIGHT_RGB_SCRATCH);
  return [
    linearToSrgb(LIGHT_RGB_SCRATCH[0]),
    linearToSrgb(LIGHT_RGB_SCRATCH[1]),
    linearToSrgb(LIGHT_RGB_SCRATCH[2]),
  ];
};

export const FACE_CORNER_TABLE: Readonly<Record<CubeFaceDirection, readonly number[]>> = {
  north: [1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0],
  south: [0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1],
  east: [1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1],
  west: [0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0],
  up: [0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 0],
  down: [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1],
};
