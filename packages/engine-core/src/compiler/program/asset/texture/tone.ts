import {
  paint,
  type FaceDirection,
  type PaintGrid,
  type PaintTone,
  type TextureRegion,
} from './raster';

const sidePainterlyTone = (y: number, height: number): PaintTone => {
  if (height <= 2) return y === 0 ? 3 : 2;
  const v = y / (height - 1);
  if (v < 0.35) return 3;
  return v < 0.75 ? 2 : 1;
};

const painterlyToneAt = (
  direction: FaceDirection | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
): PaintTone => {
  if (direction === 'up') {
    const inner =
      width >= 4 && height >= 4 && x >= 1 && x <= width - 2 && y >= 1 && y <= height - 2;
    return inner ? 4 : 3;
  }
  if (direction === 'down') return 1;
  return sidePainterlyTone(y, height);
};

const applyRegionPainterlyTone = (grid: PaintGrid, region: TextureRegion): void => {
  for (let y = 0; y < region.height; y += 1) {
    for (let x = 0; x < region.width; x += 1) {
      const index = (region.y + y) * grid.width + region.x + x;
      if (grid.fixed[index] !== 0) continue;
      const roleId = grid.values[index]!;
      if (grid.roles[roleId]?.kind !== 'ramp') continue;
      const delta = painterlyToneAt(region.direction, x, y, region.width, region.height) - 2;
      const tone = Math.max(0, Math.min(4, grid.tones[index]! + delta)) as PaintTone;
      paint(grid, region.x + x, region.y + y, roleId, tone);
    }
  }
};

/** Apply form-following Hytale painterly shading tones to unfixed ramp texels. */
export const applyPainterlyTone = (grid: PaintGrid, regions: readonly TextureRegion[]): void => {
  for (const region of regions) applyRegionPainterlyTone(grid, region);
};
