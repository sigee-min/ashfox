import type { SourceSpan } from '../../../../project/source/contract';
import type { TextureAlphaMask, TextureCanvasDetail } from '../../../../model/texture';
import {
  PRESERVE_RASTER_MAX_DETAILS,
  PRESERVE_RASTER_MAX_TOTAL_DETAILS,
} from '../../../../textures/limits';
import type { AssetTextureIssue } from './contract';
import { coherentValue, type ClusterDensity } from './cluster';
import type { PaletteRole } from './palette';

export type PaintTone = 0 | 1 | 2 | 3 | 4;
export type FaceDirection = 'north' | 'south' | 'east' | 'west' | 'up' | 'down';

export interface TextureRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly density?: 1 | 2 | 4;
  readonly direction?: FaceDirection;
  readonly boxSize?: readonly [number, number, number];
  readonly pointAt: (x: number, y: number) => readonly [number, number, number];
}

export interface TextureStampCell {
  readonly role: string;
}

export interface TextureStamp {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly cells: readonly (TextureStampCell | null)[];
  readonly span?: SourceSpan;
}

export interface PaintGrid {
  readonly width: number;
  readonly height: number;
  readonly roles: readonly PaletteRole[];
  readonly roleIds: ReadonlyMap<string, number>;
  readonly values: Uint16Array;
  readonly tones: Uint8Array;
  readonly fixed: Uint8Array;
  readonly ao: Uint8Array;
}

export interface PatternSettings {
  readonly paint: string;
  readonly scale: readonly [number, number, number];
  readonly density: ClusterDensity;
  readonly phase: number;
}

const MAX_NOISE_SAMPLES = 4_000_000;

const midpoint = (left: string, right: string): string =>
  '#' +
  [1, 3, 5]
    .map((offset) => {
      const value = Math.round(
        (Number.parseInt(left.slice(offset, offset + 2), 16) +
          Number.parseInt(right.slice(offset, offset + 2), 16)) /
          2,
      );
      return value.toString(16).padStart(2, '0');
    })
    .join('');

export const toneColor = (role: PaletteRole, tone: PaintTone): string => {
  if (role.kind === 'accent') return role.color;
  if (tone === 0) return role.shadow;
  if (tone === 1) return midpoint(role.shadow, role.base);
  if (tone === 2) return role.base;
  if (tone === 3) return midpoint(role.base, role.light);
  return role.light;
};

export const createPaintGrid = (
  width: number,
  height: number,
  palette: ReadonlyMap<string, PaletteRole>,
): PaintGrid => {
  const names = [...palette.keys()].sort();
  const roles: PaletteRole[] = [Object.freeze({ kind: 'accent', color: '#000000' })];
  const roleIds = new Map<string, number>();
  for (const name of names) {
    roleIds.set(name, roles.length);
    roles.push(palette.get(name)!);
  }
  return {
    width,
    height,
    roles: Object.freeze(roles),
    roleIds,
    values: new Uint16Array(width * height),
    tones: new Uint8Array(width * height),
    fixed: new Uint8Array(width * height),
    ao: new Uint8Array(width * height),
  };
};

export interface TextureSceneContext {
  readonly obbs: readonly import('./contract').SceneObb[];
  readonly byChart: ReadonlyMap<string, readonly import('./contract').SceneObb[]>;
  readonly boundsMin: readonly [number, number, number];
  readonly boundsMax: readonly [number, number, number];
  readonly worldPointFor: (
    chartId: string,
    region: TextureRegion,
    x: number,
    y: number,
  ) => readonly [number, number, number];
}

/** Map a region-local pixel (x, y) to continuous 3D surface coordinates in [0, w] x [0, h] x [0, d]. */
export const boxSurfacePoint = (
  region: TextureRegion,
  x: number,
  y: number,
): readonly [number, number, number] => {
  const s = region.density ?? 1;
  const px = (x + 0.5) / s;
  const py = (y + 0.5) / s;
  if (region.boxSize === undefined || region.direction === undefined) {
    return [px, region.height / s - py, 0] as const;
  }
  const [w, h, d] = region.boxSize;
  const dir: FaceDirection = region.direction;
  if (dir === 'north') return [px, h - py, 0] as const;
  if (dir === 'south') return [w - px, h - py, d] as const;
  if (dir === 'west') return [0, h - py, d - px] as const;
  if (dir === 'east') return [w, h - py, px] as const;
  if (dir === 'up') return [px, h, d - py] as const;
  return [px, 0, py] as const;
};

/** Apply accumulated Contact AO tone reductions onto unfixed ramp texels. */
export const applyAoToGrid = (grid: PaintGrid): void => {
  for (let index = 0; index < grid.ao.length; index += 1) {
    const step = grid.ao[index]!;
    if (step === 0 || grid.fixed[index] !== 0) continue;
    if (grid.roles[grid.values[index]!]?.kind !== 'ramp') continue;
    grid.tones[index] = Math.max(0, grid.tones[index]! - step);
  }
};

export const roleId = (grid: PaintGrid, name: string): number | null =>
  grid.roleIds.get(name) ?? null;

const inBounds = (grid: PaintGrid, x: number, y: number): boolean =>
  Number.isSafeInteger(x) &&
  Number.isSafeInteger(y) &&
  x >= 0 &&
  y >= 0 &&
  x < grid.width &&
  y < grid.height;

export const paint = (
  grid: PaintGrid,
  x: number,
  y: number,
  role: number,
  tone: PaintTone,
): void => {
  if (!inBounds(grid, x, y) || role <= 0 || role >= grid.roles.length) return;
  const index = y * grid.width + x;
  grid.values[index] = role;
  grid.tones[index] = tone;
};

export const paintStamp = (
  grid: PaintGrid,
  x: number,
  y: number,
  role: number,
  tone: PaintTone,
): void => {
  if (!inBounds(grid, x, y) || role <= 0 || role >= grid.roles.length) return;
  paint(grid, x, y, role, tone);
  grid.fixed[y * grid.width + x] = 1;
};

export const fill = (
  grid: PaintGrid,
  x: number,
  y: number,
  width: number,
  height: number,
  role: number,
  tone: PaintTone,
): void => {
  for (let row = Math.max(0, y); row < Math.min(grid.height, y + height); row += 1) {
    for (let column = Math.max(0, x); column < Math.min(grid.width, x + width); column += 1) {
      paint(grid, column, row, role, tone);
    }
  }
};

const validBox = (size: readonly [number, number, number]): boolean =>
  size.length === 3 && size.every((value) => Number.isSafeInteger(value) && value > 0);

/** Return the canonical net for a geometry-owned box chart. */
export const boxRegions = (
  size: readonly [number, number, number],
  density: 1 | 2 | 4 = 1,
): readonly TextureRegion[] | null => {
  if (!validBox(size)) return null;
  const width = size[0] * density;
  const height = size[1] * density;
  const depth = size[2] * density;
  const regions: Readonly<Record<FaceDirection, TextureRegion>> = {
    west: {
      x: 0,
      y: depth,
      width: depth,
      height,
      direction: 'west',
      pointAt: (x, y) => [0, y, depth - 1 - x],
    },
    north: { x: depth, y: depth, width, height, direction: 'north', pointAt: (x, y) => [x, y, 0] },
    east: {
      x: depth + width,
      y: depth,
      width: depth,
      height,
      direction: 'east',
      pointAt: (x, y) => [width - 1, y, x],
    },
    south: {
      x: depth + width + depth,
      y: depth,
      width,
      height,
      direction: 'south',
      pointAt: (x, y) => [width - 1 - x, y, depth - 1],
    },
    up: {
      x: depth,
      y: 0,
      width,
      height: depth,
      direction: 'up',
      pointAt: (x, y) => [x, height - 1, depth - 1 - y],
    },
    down: {
      x: depth + width,
      y: 0,
      width,
      height: depth,
      direction: 'down',
      pointAt: (x, y) => [x, 0, y],
    },
  };
  return Object.freeze(
    ['north', 'south', 'east', 'west', 'up', 'down'].map((id) =>
      Object.freeze({ ...regions[id as FaceDirection]!, density, boxSize: size }),
    ),
  );
};

export const sampleBudget = (regions: readonly TextureRegion[], cost: number): number | null => {
  let total = 0;
  for (const region of regions) {
    const size = region.width * region.height;
    if (!Number.isSafeInteger(size) || size < 0 || total > MAX_NOISE_SAMPLES - size * cost)
      return null;
    total += size * cost;
  }
  return total;
};

export const applyPattern = (
  grid: PaintGrid,
  regions: readonly TextureRegion[],
  settings: PatternSettings,
  issue: AssetTextureIssue,
  path: string,
  span: SourceSpan,
): boolean => {
  if (
    settings.density.denominator <= 0n ||
    settings.density.numerator < 0n ||
    settings.density.numerator > settings.density.denominator
  ) {
    issue(
      path,
      span,
      'asset.texture.invalid-ratio',
      'Blotch density must be between zero and one.',
    );
    return false;
  }
  if (sampleBudget(regions, 8) === null) {
    issue(
      path,
      span,
      'asset.texture-budget',
      'Texture pattern samples exceed the bounded work budget.',
    );
    return false;
  }
  const selected = roleId(grid, settings.paint);
  if (selected === null) {
    issue(path, span, 'asset.texture.unknown-role', 'Blotch paint role is unavailable.');
    return false;
  }
  for (const region of regions)
    for (let y = 0; y < region.height; y += 1) {
      for (let x = 0; x < region.width; x += 1) {
        if (clusterActive(region.pointAt(x, y), settings.scale, settings.density, settings.phase)) {
          paint(grid, region.x + x, region.y + y, selected, 2);
        }
      }
    }
  return true;
};

const clusterActive = (
  point: readonly [number, number, number],
  scale: readonly [number, number, number],
  density: ClusterDensity,
  seed: number,
): boolean =>
  density.numerator > 0n &&
  BigInt(coherentValue(point, scale, seed, 0)) <
    (density.numerator * 0x100000000n) / density.denominator;

export const gridDetails = (
  grid: PaintGrid,
  owner: string,
  originX: number,
  originY: number,
  path: string,
  span: SourceSpan,
  issue: AssetTextureIssue,
): readonly TextureCanvasDetail[] | null => {
  const result: TextureCanvasDetail[] = [];
  for (let row = 0; row < grid.height; row += 1) {
    let column = 0;
    while (column < grid.width) {
      const index = row * grid.width + column;
      const selected = grid.values[index]!;
      if (selected === 0) {
        column += 1;
        continue;
      }
      const tone = grid.tones[index]!;
      let end = column + 1;
      while (
        end < grid.width &&
        grid.values[row * grid.width + end] === selected &&
        grid.tones[row * grid.width + end] === tone
      )
        end += 1;
      if (result.length >= PRESERVE_RASTER_MAX_DETAILS) {
        issue(
          path,
          span,
          'asset.texture-budget',
          'Texture paint exceeds the bounded detail budget.',
        );
        return null;
      }
      result.push(
        Object.freeze({
          id: owner + ':paint:' + result.length,
          color: toneColor(grid.roles[selected]!, tone as PaintTone),
          alpha: 255,
          x: originX + column,
          y: originY + row,
          width: end - column,
          height: 1,
        }),
      );
      column = end;
    }
  }
  return Object.freeze(result);
};

export const maskFor = (
  id: string,
  origin: readonly [number, number],
  width: number,
  height: number,
  bits: string,
): TextureAlphaMask => Object.freeze({ id, x: origin[0], y: origin[1], width, height, bits });

export const detailBudgetAllows = (
  details: readonly TextureCanvasDetail[],
  masks: readonly TextureAlphaMask[],
  path: string,
  span: SourceSpan,
  issue: AssetTextureIssue,
): boolean => {
  if (
    details.length > PRESERVE_RASTER_MAX_DETAILS ||
    masks.length > PRESERVE_RASTER_MAX_DETAILS ||
    details.length + masks.length > PRESERVE_RASTER_MAX_TOTAL_DETAILS
  ) {
    issue(
      path,
      span,
      'asset.texture-budget',
      'Texture raster layers exceed the bounded detail budget.',
    );
    return false;
  }
  return true;
};
