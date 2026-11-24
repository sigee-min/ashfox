import type { SourceSpan } from '../../../../project/source/contract';
import type { AssetTextureIssue } from './contract';
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

const UINT32 = 0x100000000;
const HALF = UINT32 / 2;

const quantization = (
  anchor: PaintTone,
): Readonly<{
  readonly offset: number;
  readonly thresholds: readonly number[];
}> =>
  anchor === 4
    ? { offset: 2, thresholds: [0.29, 0.68] }
    : anchor === 0
      ? { offset: 0, thresholds: [0.29, 0.72] }
      : { offset: 0, thresholds: [0.2, 0.4, 0.6, 0.8] };

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

/** Apply bounded clustered grain across every eligible chart region. */
export const applyGrain = (
  grid: PaintGrid,
  regions: readonly TextureRegion[],
  seed: number,
  domain: string,
  path: string,
  span: SourceSpan,
  issue: AssetTextureIssue,
): boolean => {
  if (
    sampleBudget(
      regions.filter((region) => region.width * region.height > 4),
      24,
    ) === null
  ) {
    issue(path, span, 'asset.texture-budget', 'Clustered grain exceeds the bounded work budget.');
    return false;
  }
  const finalSeed = (seed ^ hashText(domain)) >>> 0;
  for (const region of regions)
    if (region.width * region.height > 4) grainRegion(region, grid, finalSeed);
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
