import type { SourceSpan } from '../../../../project/source/contract';
import type { AssetTextureIssue, GrainMode } from './contract';
import { coherentValue, hashText } from './cluster';
import type { PaletteRole } from './palette';
import {
  paint,
  sampleBudget,
  type FaceDirection,
  type PaintGrid,
  type PaintTone,
  type TextureRegion,
} from './raster';

export type { GrainMode } from './contract';

const UINT32 = 0x100000000;
const HALF = UINT32 / 2;

const quantization = (
  anchor: PaintTone,
): Readonly<{
  readonly offset: number;
  readonly thresholds: readonly number[];
}> => {
  if (anchor === 4) return { offset: 2, thresholds: [0.29, 0.68] };
  if (anchor === 3) return { offset: 2, thresholds: [0.25, 0.65] };
  if (anchor === 1) return { offset: 0, thresholds: [0.35, 0.75] };
  if (anchor === 0) return { offset: 0, thresholds: [0.29, 0.72] };
  return { offset: 0, thresholds: [0.2, 0.4, 0.6, 0.8] };
};

const rawToneAt = (
  point: readonly [number, number, number],
  seed: number,
  anchor: PaintTone,
): PaintTone => {
  const coherent = coherentValue(point, [3, 3, 3], seed, 211);
  const micro = coherentValue(point, [2, 2, 2], seed, 307);
  const score = anchor === 2 ? HALF + ((coherent - HALF) * 3) / 2 : HALF + ((micro - HALF) * 5) / 2;
  const normalized = Math.max(0, Math.min(UINT32 - 1, score)) / UINT32;
  const range = quantization(anchor);
  for (let tone = 0; tone < range.thresholds.length; tone += 1) {
    if (normalized < range.thresholds[tone]!) return (range.offset + tone) as PaintTone;
  }
  return (range.offset + range.thresholds.length) as PaintTone;
};

const eligible = (role: PaletteRole | undefined): boolean => role?.kind === 'ramp';

const isBoundary = (x: number, y: number, width: number, height: number): boolean =>
  x === 0 || y === 0 || x === width - 1 || y === height - 1;

const neighborRange = (
  current: Uint8Array,
  mask: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): Readonly<{ readonly min: number; readonly max: number }> | null => {
  let min = 4;
  let max = 0;
  let count = 0;
  const offsets: readonly (readonly [number, number])[] = [
    [x - 1, y],
    [x + 1, y],
    [x, y - 1],
    [x, y + 1],
  ];
  for (const [nx, ny] of offsets) {
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    const neighbor = ny * width + nx;
    if (mask[neighbor] === 0) continue;
    min = Math.min(min, current[neighbor]!);
    max = Math.max(max, current[neighbor]!);
    count += 1;
  }
  return count === 0 ? null : { min, max };
};

const relaxCell = (
  current: Uint8Array,
  mask: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  preserveBoundary: boolean,
): number => {
  const index = y * width + x;
  if (mask[index] === 0) return current[index]!;
  if (preserveBoundary && isBoundary(x, y, width, height)) return current[index]!;
  const range = neighborRange(current, mask, width, height, x, y);
  if (range === null) return current[index]!;
  const low = range.max - 1;
  const high = range.min + 1;
  return low <= high
    ? Math.max(low, Math.min(high, current[index]!))
    : Math.round((low + high) / 2);
};

const relaxPass = (
  current: Uint8Array,
  next: Uint8Array,
  mask: Uint8Array,
  width: number,
  height: number,
  preserveBoundary: boolean,
): void => {
  next.set(current);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      next[y * width + x] = relaxCell(current, mask, width, height, x, y, preserveBoundary);
    }
  }
};

const relax = (
  source: Uint8Array,
  mask: Uint8Array,
  width: number,
  height: number,
  preserveBoundary: boolean,
): Uint8Array => {
  let current: Uint8Array<ArrayBufferLike> = source;
  let next: Uint8Array<ArrayBufferLike> = new Uint8Array(source.length);
  for (let pass = 0; pass < 3; pass += 1) {
    relaxPass(current, next, mask, width, height, preserveBoundary);
    const previous = current;
    current = next;
    next = previous;
  }
  return current;
};

const grainRegion = (region: TextureRegion, grid: PaintGrid, seed: number): void => {
  const size = region.width * region.height;
  const raw = new Uint8Array(size);
  const anchors = new Uint8Array(size);
  const mask = new Uint8Array(size);
  for (let y = 0; y < region.height; y += 1) {
    for (let x = 0; x < region.width; x += 1) {
      const local = y * region.width + x;
      const index = (region.y + y) * grid.width + region.x + x;
      if (grid.fixed[index] !== 0 || !eligible(grid.roles[grid.values[index]!])) continue;
      mask[local] = 1;
      const anchor = grid.tones[index] as PaintTone;
      anchors[local] = anchor;
      raw[local] = rawToneAt(region.pointAt(x, y), seed, anchor);
    }
  }
  const preserveBoundary = region.direction !== undefined;
  const first = mask.findIndex((value) => value !== 0);
  const neutral = first >= 0 && anchors[first] === 2;
  const values = neutral ? relax(raw, mask, region.width, region.height, preserveBoundary) : raw;
  for (let y = 0; y < region.height; y += 1) {
    for (let x = 0; x < region.width; x += 1) {
      const local = y * region.width + x;
      if (mask[local] === 0) continue;
      const index = (region.y + y) * grid.width + region.x + x;
      paint(grid, region.x + x, region.y + y, grid.values[index]!, values[local] as PaintTone);
    }
  }
};

const softGrainRegion = (region: TextureRegion, grid: PaintGrid, seed: number): void => {
  for (let y = 0; y < region.height; y += 1) {
    for (let x = 0; x < region.width; x += 1) {
      const index = (region.y + y) * grid.width + region.x + x;
      if (grid.fixed[index] !== 0 || !eligible(grid.roles[grid.values[index]!])) continue;
      const anchor = grid.tones[index]!;
      const norm = coherentValue(region.pointAt(x, y), [3, 3, 3], seed, 419) / UINT32;
      const delta = norm < 0.18 ? -1 : norm > 0.82 ? 1 : 0;
      const next = Math.max(0, Math.min(4, anchor + delta)) as PaintTone;
      paint(grid, region.x + x, region.y + y, grid.values[index]!, next);
    }
  }
};

const DIRECTIONAL_SCALES: Readonly<
  Record<'fur' | 'wood' | 'cloth' | 'brushed', readonly [number, number, number]>
> = {
  fur: [1, 3, 1],
  wood: [4, 1, 4],
  cloth: [2, 2, 2],
  brushed: [3, 1, 3],
};

const DIRECTIONAL_STREAMS: Readonly<Record<'fur' | 'wood' | 'cloth' | 'brushed', number>> = {
  fur: 503,
  wood: 601,
  cloth: 701,
  brushed: 809,
};

const directionalDeltaAt = (
  region: TextureRegion,
  x: number,
  y: number,
  seed: number,
  mode: 'fur' | 'wood' | 'cloth' | 'brushed',
): number => {
  if (mode === 'cloth' && ((x + y) & 1) === 1) return 0;
  const norm =
    coherentValue(region.pointAt(x, y), DIRECTIONAL_SCALES[mode], seed, DIRECTIONAL_STREAMS[mode]) /
    UINT32;
  const cut = mode === 'cloth' ? 0.22 : 0.2;
  return norm < cut ? -1 : norm > 1 - cut ? 1 : 0;
};

const directionalGrainRegion = (
  region: TextureRegion,
  grid: PaintGrid,
  seed: number,
  mode: 'fur' | 'wood' | 'cloth' | 'brushed',
): void => {
  for (let y = 0; y < region.height; y += 1) {
    for (let x = 0; x < region.width; x += 1) {
      const index = (region.y + y) * grid.width + region.x + x;
      if (grid.fixed[index] !== 0 || !eligible(grid.roles[grid.values[index]!])) continue;
      const delta = directionalDeltaAt(region, x, y, seed, mode);
      if (delta === 0) continue;
      const next = Math.max(0, Math.min(4, grid.tones[index]! + delta)) as PaintTone;
      paint(grid, region.x + x, region.y + y, grid.values[index]!, next);
    }
  }
};

/** Apply region-resolved grain modes across all eligible regions. */
export const applyGrainModes = (
  grid: PaintGrid,
  regions: readonly TextureRegion[],
  modeFor: (region: TextureRegion) => GrainMode,
  seed: number,
  domain: string,
  path: string,
  span: SourceSpan,
  issue: AssetTextureIssue,
): boolean => {
  const active = regions.filter(
    (region) => region.width * region.height > 4 && modeFor(region) !== 'none',
  );
  if (sampleBudget(active, 24) === null) {
    issue(path, span, 'asset.texture-budget', 'Clustered grain exceeds the bounded work budget.');
    return false;
  }
  const finalSeed = (seed ^ hashText(domain)) >>> 0;
  for (const region of active) {
    const mode = modeFor(region);
    if (mode === 'soft') softGrainRegion(region, grid, finalSeed);
    else if (mode === 'clustered') grainRegion(region, grid, finalSeed);
    else if (mode === 'fur' || mode === 'wood' || mode === 'cloth' || mode === 'brushed') {
      directionalGrainRegion(region, grid, finalSeed, mode);
    }
  }
  return true;
};

const voxelToneForDirection = (direction?: FaceDirection): PaintTone => {
  if (direction === 'up') return 4;
  if (direction === 'down') return 0;
  return 2;
};

const applyRegionVoxelTone = (grid: PaintGrid, region: TextureRegion): void => {
  const tone = voxelToneForDirection(region.direction);
  for (let y = 0; y < region.height; y += 1) {
    for (let x = 0; x < region.width; x += 1) {
      const index = (region.y + y) * grid.width + region.x + x;
      if (grid.fixed[index] === 0 && grid.roles[grid.values[index]!]?.kind === 'ramp') {
        paint(grid, region.x + x, region.y + y, grid.values[index]!, tone);
      }
    }
  }
};

/** Apply directional voxel shading tones to unfixed ramp texels. */
export const applyVoxelTone = (grid: PaintGrid, regions: readonly TextureRegion[]): void => {
  for (const region of regions) applyRegionVoxelTone(grid, region);
};
