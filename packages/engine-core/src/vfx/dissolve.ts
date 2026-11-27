import type {
  VfxDissolveAtlas,
  VfxDissolveMode,
  VfxDissolveSpec,
  VfxPalette,
  VfxTextureBuffer,
} from './contract';
import { fbm2D, voronoi2D } from './noise';
import { hexToRgb01, resolvePaletteHex, writeVfxRgbaPixel } from './oklch';

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

const computeMaskValue = (
  u: number,
  v: number,
  mode: VfxDissolveMode,
  seed: number,
  directionDeg: number,
): number => {
  if (mode === 'voronoi') {
    return clamp01(voronoi2D(u * 5.0, v * 5.0, seed));
  }
  if (mode === 'simplex') {
    return clamp01(fbm2D(u * 4.5, v * 4.5, seed, 3));
  }
  if (mode === 'directional_wipe') {
    const rad = (directionDeg * Math.PI) / 180;
    const proj = (u - 0.5) * Math.cos(rad) + (v - 0.5) * Math.sin(rad) + 0.5;
    const jitter = (fbm2D(u * 6.0, v * 6.0, seed, 2) - 0.5) * 0.24;
    return clamp01(proj + jitter);
  }
  const radialDist = Math.hypot(u - 0.5, v - 0.5) * 1.414;
  const noise = (fbm2D(u * 5.5, v * 5.5, seed, 3) - 0.5) * 0.28;
  return clamp01(1 - radialDist + noise);
};

const computeMaskField = (width: number, height: number, spec: VfxDissolveSpec): Float32Array => {
  const mask = new Float32Array(width * height);
  const seed = spec.seed ?? 1337;
  const directionDeg = spec.directionDeg ?? 0;
  for (let y = 0; y < height; y += 1) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x += 1) {
      const u = (x + 0.5) / width;
      mask[y * width + x] = computeMaskValue(u, v, spec.mode, seed, directionDeg);
    }
  }
  return mask;
};

const blitDissolveCell = (
  base: VfxTextureBuffer,
  mask: Float32Array,
  atlas: Uint8Array,
  atlasWidth: number,
  cellX: number,
  cellY: number,
  threshold: number,
  edgeWidth: number,
  edgeRgb: readonly [number, number, number],
): void => {
  const w = base.width;
  const h = base.height;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const idx = y * w + x;
      const srcOffset = idx * 4;
      const dstOffset = ((cellY * h + y) * atlasWidth + (cellX * w + x)) * 4;
      const baseAlpha = base.rgba[srcOffset + 3]! / 255;
      const m = mask[idx]!;
      if (m < threshold || baseAlpha <= 0) {
        atlas[dstOffset] = 0;
        atlas[dstOffset + 1] = 0;
        atlas[dstOffset + 2] = 0;
        atlas[dstOffset + 3] = 0;
      } else if (m < threshold + edgeWidth) {
        writeVfxRgbaPixel(atlas, dstOffset, edgeRgb, baseAlpha, base.blendMode);
      } else {
        atlas[dstOffset] = base.rgba[srcOffset]!;
        atlas[dstOffset + 1] = base.rgba[srcOffset + 1]!;
        atlas[dstOffset + 2] = base.rgba[srcOffset + 2]!;
        atlas[dstOffset + 3] = base.rgba[srcOffset + 3]!;
      }
    }
  }
};

/**
 * Pre-bake shader-free alpha-dissolve flipbook erosion atlas (8..16 frames).
 * Pixels with mask < d become alpha=0; [d, d + w_edge) glow with hot OKLCH edge color;
 * >= d + w_edge retain the base texture.
 */
export const bakeDissolveFlipbook = (
  base: VfxTextureBuffer,
  spec: VfxDissolveSpec,
  palette: VfxPalette,
): VfxDissolveAtlas => {
  const frameCount = Math.max(2, Math.min(24, Math.round(spec.frames)));
  const columns = Math.ceil(Math.sqrt(frameCount));
  const rows = Math.ceil(frameCount / columns);
  const atlasWidth = columns * base.width;
  const atlasHeight = rows * base.height;
  const atlas = new Uint8Array(atlasWidth * atlasHeight * 4);
  const mask = computeMaskField(base.width, base.height, spec);
  const edgeWidth = Math.max(0.02, Math.min(0.4, spec.edgeWidth));
  const edgeRgb = hexToRgb01(resolvePaletteHex(palette, spec.edgeGlowRole));
  const thresholds: number[] = [];

  for (let frame = 0; frame < frameCount; frame += 1) {
    const threshold = frameCount === 1 ? 0 : (frame / (frameCount - 1)) * 1.02;
    thresholds.push(threshold);
    const col = frame % columns;
    const row = Math.floor(frame / columns);
    blitDissolveCell(base, mask, atlas, atlasWidth, col, row, threshold, edgeWidth, edgeRgb);
  }

  return Object.freeze({
    mode: spec.mode,
    cellWidth: base.width,
    cellHeight: base.height,
    columns,
    rows,
    frameCount,
    atlasWidth,
    atlasHeight,
    rgba: atlas,
    frameThresholds: Object.freeze(thresholds),
    blendMode: base.blendMode,
  });
};
