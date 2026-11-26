import type { CompiledModel } from '../../model/compiled';
import type { Vec3 } from '../../model/identity';
import type { CubeFaceDirection } from '../../model/scene';
import type { IntVec3 } from '../../project/structure/contract';
import type { BlockDescriptor } from './blocks';
import type { PlayableLight, StructureGrid, StructureLightingField } from './contract';

export interface FaceBasis {
  readonly normal: IntVec3;
  readonly uAxis: IntVec3;
  readonly vAxis: IntVec3;
  readonly shade: number;
}

export const FACE_BASIS: Readonly<Record<CubeFaceDirection, FaceBasis>> = {
  north: { normal: [0, 0, -1], uAxis: [-1, 0, 0], vAxis: [0, 1, 0], shade: 0.88 },
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
const AO_CURVE: readonly [number, number, number, number] = [1.0, 0.78, 0.58, 0.4];
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const linearToSrgb = (c: number): number => {
  const v = clamp01(c);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
};

interface EmissiveProfile {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly kind: PlayableLight['kind'];
  readonly color: string;
  readonly intensity: number;
  readonly radius: number;
}

const PROFILES = {
  soul: {
    r: 120,
    g: 235,
    b: 255,
    kind: 'soul_lantern',
    color: '#78ebff',
    intensity: 1.15,
    radius: 7,
  },
  rune: {
    r: 110,
    g: 230,
    b: 245,
    kind: 'emissive_prop',
    color: '#6ee6f5',
    intensity: 0.95,
    radius: 6,
  },
  lantern: { r: 255, g: 208, b: 128, kind: 'lantern', color: '#ffd080', intensity: 1.2, radius: 8 },
  hearth: { r: 255, g: 165, b: 85, kind: 'hearth', color: '#ffa555', intensity: 1.35, radius: 9 },
  furnace: { r: 255, g: 150, b: 75, kind: 'hearth', color: '#ff964b', intensity: 0.95, radius: 6 },
  torch: { r: 255, g: 195, b: 110, kind: 'torch', color: '#ffc36e', intensity: 0.95, radius: 6 },
} as const satisfies Record<string, EmissiveProfile>;

const STATE_PROFILE_RULES: readonly [string, EmissiveProfile][] = [
  ['soul_lantern', PROFILES.soul],
  ['sea_lantern', PROFILES.soul],
  ['campfire', PROFILES.hearth],
  ['furnace', PROFILES.furnace],
  ['torch', PROFILES.torch],
];

const emissiveProfileForState = (
  state: string,
  desc: BlockDescriptor,
  tag: string | null,
): EmissiveProfile | null => {
  if (tag) {
    if (tag.includes('soul')) return PROFILES.soul;
    if (tag.includes('rune')) return PROFILES.rune;
    if (tag.includes('lantern') || tag.includes('lamp') || desc.light) return PROFILES.lantern;
    return null;
  }
  if (!desc.light) return null;
  return STATE_PROFILE_RULES.find(([key]) => state.includes(key))?.[1] ?? PROFILES.lantern;
};

const isOpaqueAt = (
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
    grid.customTags[idx] === null && grid.voxels[idx]! > 0 && descs[grid.voxels[idx]!]!.solidOpaque
  );
};

interface SkyCtx {
  readonly grid: StructureGrid;
  readonly descs: readonly BlockDescriptor[];
  readonly sky: Uint8Array;
  readonly queue: Int32Array;
}

const seedSkyColumn = (ctx: SkyCtx, x: number, z: number, tail: number): number => {
  const [w, h, d] = ctx.grid.size;
  let light = 255;
  let nextTail = tail;
  for (let y = h - 1; y >= 0; y -= 1) {
    const idx = (y * d + z) * w + x;
    const v = ctx.grid.voxels[idx]!;
    if (v > 0 && ctx.grid.customTags[idx] === null && ctx.descs[v]!.solidOpaque) break;
    if (v > 0 && ctx.descs[v]!.top === 'leaves') light = Math.max(64, light - 56);
    ctx.sky[idx] = light;
    ctx.queue[nextTail++] = idx;
  }
  return nextTail;
};

const stepSkyNeighbors = (ctx: SkyCtx, cur: number, tail: number): number => {
  const [w, h, d] = ctx.grid.size;
  const curVal = ctx.sky[cur]!;
  if (curVal <= 28) return tail;
  const x = cur % w;
  const z = Math.floor(cur / w) % d;
  const y = Math.floor(cur / (w * d));
  let nextTail = tail;
  for (const [dx, dy, dz] of DIRS6) {
    const nx = x + dx;
    const ny = y + dy;
    const nz = z + dz;
    if (
      nx < 0 ||
      nx >= w ||
      ny < 0 ||
      ny >= h ||
      nz < 0 ||
      nz >= d ||
      isOpaqueAt(ctx.grid, ctx.descs, nx, ny, nz)
    )
      continue;
    const nextVal = curVal - (dy < 0 ? 16 : 32);
    const nIdx = (ny * d + nz) * w + nx;
    if (nextVal > ctx.sky[nIdx]!) {
      ctx.sky[nIdx] = nextVal;
      ctx.queue[nextTail++] = nIdx;
    }
  }
  return nextTail;
};

const floodSkyLight = (
  grid: StructureGrid,
  descs: readonly BlockDescriptor[],
  sky: Uint8Array,
): void => {
  const [w, h, d] = grid.size;
  const ctx: SkyCtx = { grid, descs, sky, queue: new Int32Array(w * h * d) };
  let tail = 0;
  for (let z = 0; z < d; z += 1)
    for (let x = 0; x < w; x += 1) tail = seedSkyColumn(ctx, x, z, tail);
  let head = 0;
  while (head < tail) tail = stepSkyNeighbors(ctx, ctx.queue[head++]!, tail);
};

interface RgbCtx {
  readonly grid: StructureGrid;
  readonly descs: readonly BlockDescriptor[];
  readonly blockR: Uint8Array;
  readonly blockG: Uint8Array;
  readonly blockB: Uint8Array;
  readonly queue: Int32Array;
}

const seedBlockLights = (
  ctx: RgbCtx,
  customModels: Readonly<Record<string, CompiledModel>>,
): { readonly tail: number; readonly lights: PlayableLight[] } => {
  const [w, h, d] = ctx.grid.size;
  const lights: PlayableLight[] = [];
  let tail = 0;
  for (let idx = 0; idx < w * h * d; idx += 1) {
    const v = ctx.grid.voxels[idx]!;
    if (v <= 0) continue;
    const tag = ctx.grid.customTags[idx]!;
    const hasEmissive =
      tag && customModels[tag]
        ? Object.values(customModels[tag]!.textures).some((t) => t.renderMode === 'emissive')
        : false;
    const active =
      emissiveProfileForState(ctx.grid.states[v]!, ctx.descs[v]!, tag) ??
      (hasEmissive ? PROFILES.rune : null);
    if (!active) continue;
    ctx.blockR[idx] = Math.max(ctx.blockR[idx]!, active.r);
    ctx.blockG[idx] = Math.max(ctx.blockG[idx]!, active.g);
    ctx.blockB[idx] = Math.max(ctx.blockB[idx]!, active.b);
    ctx.queue[tail++] = idx;
    const x = idx % w;
    const z = Math.floor(idx / w) % d;
    const y = Math.floor(idx / (w * d));
    lights.push({
      id: `light_${lights.length}`,
      position: [x - w / 2 + 0.5, y + 0.5, z - d / 2 + 0.5],
      color: active.color,
      intensity: active.intensity,
      radius: active.radius,
      kind: active.kind,
    });
  }
  return { tail, lights };
};

const stepRgbNeighbors = (ctx: RgbCtx, cur: number, tail: number): number => {
  const [w, h, d] = ctx.grid.size;
  const nr = Math.max(0, ctx.blockR[cur]! - 21);
  const ng = Math.max(0, ctx.blockG[cur]! - 21);
  const nb = Math.max(0, ctx.blockB[cur]! - 21);
  if (nr === 0 && ng === 0 && nb === 0) return tail;
  const x = cur % w;
  const z = Math.floor(cur / w) % d;
  const y = Math.floor(cur / (w * d));
  let nextTail = tail;
  for (const [dx, dy, dz] of DIRS6) {
    const nx = x + dx;
    const ny = y + dy;
    const nz = z + dz;
    if (
      nx < 0 ||
      nx >= w ||
      ny < 0 ||
      ny >= h ||
      nz < 0 ||
      nz >= d ||
      isOpaqueAt(ctx.grid, ctx.descs, nx, ny, nz)
    )
      continue;
    const nIdx = (ny * d + nz) * w + nx;
    if (nr > ctx.blockR[nIdx]! || ng > ctx.blockG[nIdx]! || nb > ctx.blockB[nIdx]!) {
      ctx.blockR[nIdx] = Math.max(ctx.blockR[nIdx]!, nr);
      ctx.blockG[nIdx] = Math.max(ctx.blockG[nIdx]!, ng);
      ctx.blockB[nIdx] = Math.max(ctx.blockB[nIdx]!, nb);
      if (nextTail < ctx.queue.length) ctx.queue[nextTail++] = nIdx;
    }
  }
  return nextTail;
};

export const computeStructureLighting = (
  grid: StructureGrid,
  descs: readonly BlockDescriptor[],
  customModels: Readonly<Record<string, CompiledModel>> = {},
): { readonly lighting: StructureLightingField; readonly lights: readonly PlayableLight[] } => {
  const vol = grid.size[0] * grid.size[1] * grid.size[2];
  const sky = new Uint8Array(vol);
  const blockR = new Uint8Array(vol);
  const blockG = new Uint8Array(vol);
  const blockB = new Uint8Array(vol);
  floodSkyLight(grid, descs, sky);
  const ctx: RgbCtx = { grid, descs, blockR, blockG, blockB, queue: new Int32Array(vol * 2) };
  let { tail, lights } = seedBlockLights(ctx, customModels);
  let head = 0;
  while (head < tail) tail = stepRgbNeighbors(ctx, ctx.queue[head++]!, tail);
  return { lighting: { size: grid.size, sky, blockR, blockG, blockB }, lights };
};

const sampleCellLight = (
  lighting: StructureLightingField,
  x: number,
  y: number,
  z: number,
): readonly [number, number, number] => {
  const [w, h, d] = lighting.size;
  if (x < 0 || x >= w || y >= h || z < 0 || z >= d) return [1, 1, 1];
  if (y < 0) return [0.35, 0.35, 0.38];
  const idx = (y * d + z) * w + x;
  const skyLin = (lighting.sky[idx]! / 255) * 0.85 + 0.14;
  return [
    clamp01(skyLin * 0.92 + (lighting.blockR[idx]! / 255) * 1.1),
    clamp01(skyLin * 0.95 + (lighting.blockG[idx]! / 255) * 1.02),
    clamp01(skyLin * 1.02 + (lighting.blockB[idx]! / 255) * 0.92),
  ];
};

const occluderAt = (
  grid: StructureGrid,
  descs: readonly BlockDescriptor[],
  x: number,
  y: number,
  z: number,
  maxY: number,
): 0 | 1 => {
  const [w, h, d] = grid.size;
  if (x < 0 || x >= w || y < 0 || y >= Math.min(h, maxY) || z < 0 || z >= d) return 0;
  const idx = (y * d + z) * w + x;
  return grid.customTags[idx] === null &&
    grid.voxels[idx]! > 0 &&
    descs[grid.voxels[idx]!]!.solidOpaque
    ? 1
    : 0;
};

const vertexAo = (
  grid: StructureGrid,
  descs: readonly BlockDescriptor[],
  sx: number,
  sy: number,
  sz: number,
  basis: FaceBasis,
  su: number,
  sv: number,
  maxY: number,
): number => {
  const s1 = occluderAt(
    grid,
    descs,
    sx + su * basis.uAxis[0],
    sy + su * basis.uAxis[1],
    sz + su * basis.uAxis[2],
    maxY,
  );
  const s2 = occluderAt(
    grid,
    descs,
    sx + sv * basis.vAxis[0],
    sy + sv * basis.vAxis[1],
    sz + sv * basis.vAxis[2],
    maxY,
  );
  if (s1 === 1 && s2 === 1) return 3;
  const c = occluderAt(
    grid,
    descs,
    sx + su * basis.uAxis[0] + sv * basis.vAxis[0],
    sy + su * basis.uAxis[1] + sv * basis.vAxis[1],
    sz + su * basis.uAxis[2] + sv * basis.vAxis[2],
    maxY,
  );
  return s1 + s2 + c;
};

export interface FaceShadeInfo {
  readonly ao: readonly [number, number, number, number];
  readonly flip: boolean;
  readonly quantizedTint: number;
  readonly colors: readonly number[];
}

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
): FaceShadeInfo => {
  if (isEmissive)
    return {
      ao: [0, 0, 0, 0],
      flip: false,
      quantizedTint: 32767,
      colors: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    };
  const basis = FACE_BASIS[dir];
  const sx = x + basis.normal[0];
  const sy = y + basis.normal[1];
  const sz = z + basis.normal[2];
  const aos: readonly [number, number, number, number] = [
    vertexAo(grid, descs, sx, sy, sz, basis, -1, -1, maxY),
    vertexAo(grid, descs, sx, sy, sz, basis, 1, -1, maxY),
    vertexAo(grid, descs, sx, sy, sz, basis, 1, 1, maxY),
    vertexAo(grid, descs, sx, sy, sz, basis, -1, 1, maxY),
  ];
  const [lr, lg, lb] = useSampleCell
    ? sampleCellLight(lighting, sx, sy, sz)
    : sampleCellLight(lighting, x, y, z);
  const fr = lr * basis.shade;
  const fg = lg * basis.shade;
  const fb = lb * basis.shade;
  const quantizedTint =
    (Math.min(15, Math.round(fr * 15)) << 8) |
    (Math.min(15, Math.round(fg * 15)) << 4) |
    Math.min(15, Math.round(fb * 15));
  const colors = aos.flatMap((k) => [
    linearToSrgb(fr * AO_CURVE[k]!),
    linearToSrgb(fg * AO_CURVE[k]!),
    linearToSrgb(fb * AO_CURVE[k]!),
  ]);
  return { ao: aos, flip: aos[0] + aos[2] > aos[1] + aos[3], quantizedTint, colors };
};

export const samplePropLightRgb = (
  lighting: StructureLightingField,
  x: number,
  y: number,
  z: number,
): readonly [number, number, number] => {
  const [r, g, b] = sampleCellLight(lighting, x, y, z);
  return [linearToSrgb(r), linearToSrgb(g), linearToSrgb(b)];
};

const FACE_TABLE: Readonly<
  Record<
    CubeFaceDirection,
    readonly [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ]
  >
> = {
  north: [1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0],
  south: [0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1],
  east: [1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1],
  west: [0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0],
  up: [0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 0],
  down: [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1],
};

export const faceCorners = (
  dir: CubeFaceDirection,
  from: Vec3,
  to: Vec3,
): readonly [Vec3, Vec3, Vec3, Vec3] => {
  const t = FACE_TABLE[dir];
  const pick = (i: number): Vec3 => [
    t[i]! ? to[0] : from[0],
    t[i + 1]! ? to[1] : from[1],
    t[i + 2]! ? to[2] : from[2],
  ];
  return [pick(0), pick(3), pick(6), pick(9)];
};
