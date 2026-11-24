import type { CubeFaceDirection, Vec3 } from '../model';

export interface UvAtlasRect<TValue> {
  key: string;
  width: number;
  height: number;
  value: TValue;
}

export interface UvAtlasPlacement<TValue> extends UvAtlasRect<TValue> {
  x: number;
  y: number;
}

export const cubeFaceDimensions = (
  from: Vec3,
  to: Vec3,
  face: CubeFaceDirection,
): { width: number; height: number } => {
  const sizeX = Math.abs(to[0] - from[0]);
  const sizeY = Math.abs(to[1] - from[1]);
  const sizeZ = Math.abs(to[2] - from[2]);
  switch (face) {
    case 'north':
    case 'south':
      return { width: sizeX, height: sizeY };
    case 'east':
    case 'west':
      return { width: sizeZ, height: sizeY };
    case 'up':
    case 'down':
      return { width: sizeX, height: sizeZ };
  }
};

export const faceTexelSize = (
  dimensions: { width: number; height: number },
  modelUnitsPerBlock: number,
  pixelsPerBlock: number,
): { width: number; height: number } | null => {
  if (
    !Number.isFinite(modelUnitsPerBlock) ||
    modelUnitsPerBlock <= 0 ||
    !Number.isFinite(pixelsPerBlock) ||
    pixelsPerBlock <= 0
  ) {
    return null;
  }
  const scale = pixelsPerBlock / modelUnitsPerBlock;
  const width = Math.round(dimensions.width * scale);
  const height = Math.round(dimensions.height * scale);
  return width > 0 && height > 0 ? { width, height } : null;
};

export const packUvAtlas = <TValue>(
  rects: readonly UvAtlasRect<TValue>[],
  width: number,
  height: number,
  padding: number,
): UvAtlasPlacement<TValue>[] | null => {
  const sorted = [...rects].sort((left, right) => {
    if (right.height !== left.height) return right.height - left.height;
    if (right.width !== left.width) return right.width - left.width;
    return left.key.localeCompare(right.key);
  });
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  const placements: UvAtlasPlacement<TValue>[] = [];
  for (const rect of sorted) {
    if (rect.width > width || rect.height > height) return null;
    if (x + rect.width > width) {
      x = 0;
      y += rowHeight + padding;
      rowHeight = 0;
    }
    if (y + rect.height > height) return null;
    placements.push({ ...rect, x, y });
    x += rect.width + padding;
    rowHeight = Math.max(rowHeight, rect.height);
  }
  return placements;
};

export const reduceAtlasPixelsPerBlock = (value: number): number | null => {
  if (!Number.isFinite(value) || value <= 1) return null;
  const current = Math.trunc(value);
  if (current <= 1) return null;
  return current <= 4 ? current - 1 : Math.max(1, Math.floor(current * 0.5));
};
