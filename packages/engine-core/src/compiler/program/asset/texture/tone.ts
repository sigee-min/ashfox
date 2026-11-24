import {
  paint,
  type FaceDirection,
  type PaintGrid,
  type PaintTone,
  type TextureRegion,
} from './raster';

const isRim = (x: number, y: number, width: number, height: number): boolean =>
  width >= 3 && height >= 3 && (x === 0 || y === 0 || x === width - 1 || y === height - 1);

const sidePainterlyTone = (
  direction: FaceDirection | undefined,
  y: number,
  height: number,
): PaintTone => {
  if (height <= 2) return y === 0 ? 3 : 2;
  if (y === 0) return 4;
  if (height >= 6 && y === height - 1 && direction !== undefined) return 0;
  const v = y / (height - 1);
  if (v < 0.45) return 3;
  return v < 0.78 ? 2 : 1;
};

const painterlyToneAt = (
  direction: FaceDirection | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
): PaintTone => {
  if (direction === 'up') return isRim(x, y, width, height) ? 4 : 3;
  if (direction === 'down') return isRim(x, y, width, height) ? 0 : 1;
  return sidePainterlyTone(direction, y, height);
};

const applyRegionPainterlyTone = (grid: PaintGrid, region: TextureRegion): void => {
  for (let y = 0; y < region.height; y += 1) {
    for (let x = 0; x < region.width; x += 1) {
      const index = (region.y + y) * grid.width + region.x + x;
      if (grid.fixed[index] !== 0) continue;
      const roleId = grid.values[index]!;
      if (grid.roles[roleId]?.kind !== 'ramp') continue;
      const tone = painterlyToneAt(region.direction, x, y, region.width, region.height);
      paint(grid, region.x + x, region.y + y, roleId, tone);
    }
  }
};

/** Apply form-following Hytale painterly shading tones to unfixed ramp texels. */
export const applyPainterlyTone = (grid: PaintGrid, regions: readonly TextureRegion[]): void => {
  for (const region of regions) applyRegionPainterlyTone(grid, region);
};
