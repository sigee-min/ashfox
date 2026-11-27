import { encodeBase64Bytes } from './textureRecipe/base64';
import { encodeCanonicalPng } from './textureRecipe/png';
import { createCanonicalTextureRaster } from './textureRecipe/raster';

export type NormalGrainKind =
  'clustered' | 'soft' | 'fur' | 'wood' | 'cloth' | 'brushed' | 'stone' | 'none';

export type NormalPatternKind = 'brick' | 'plank' | 'tile' | 'seam' | 'none';

export interface NormalRegionBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly strength: number;
}

const NORMAL_GRADIENT_GAIN = 3.2;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

const clampByte = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));

const hash3 = (x: number, y: number, z: number, seed: number, stream: number): number => {
  let h =
    (Math.imul(x, 0x9e3779b1) ^
      Math.imul(y, 0x85ebca6b) ^
      Math.imul(z, 0xc2b2ae35) ^
      Math.imul(seed ^ stream, 0x27d4eb2f)) >>>
    0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  return Math.imul(h, 0x297a2d39) >>> 0;
};

const coherent01 = (
  point: readonly [number, number, number],
  scale: readonly [number, number, number],
  seed: number,
  stream: number,
): number => {
  const gx = Math.floor(point[0] / Math.max(1, scale[0]));
  const gy = Math.floor(point[1] / Math.max(1, scale[1]));
  const gz = Math.floor(point[2] / Math.max(1, scale[2]));
  return hash3(gx, gy, gz, seed, stream) / 0xffffffff;
};

/** Compute deterministic micro-height offset in [-0.35, +0.35] for a grain mode. */
export const grainHeightOffset = (
  point: readonly [number, number, number],
  seed: number,
  grain: NormalGrainKind,
  lx: number,
  ly: number,
): number => {
  if (grain === 'none') return 0;
  if (grain === 'cloth') {
    const weave = (lx & 1) === (ly & 1) ? 0.16 : -0.16;
    return weave + (coherent01(point, [2, 2, 2], seed, 701) - 0.5) * 0.24;
  }
  if (grain === 'brushed') {
    const streak = coherent01(point, [4, 1, 4], seed, 809) - 0.5;
    return streak * 0.45 + ((ly & 1) === 0 ? 0.05 : -0.05);
  }
  if (grain === 'wood') {
    const fiber = coherent01(point, [4, 1, 4], seed, 601) - 0.5;
    return fiber * 0.48 + Math.sin((point[0] + point[2]) * 1.4 + ly * 0.2) * 0.12;
  }
  if (grain === 'fur') {
    return (coherent01(point, [1, 3, 1], seed, 503) - 0.5) * 0.55;
  }
  if (grain === 'soft') {
    return (coherent01(point, [3, 3, 3], seed, 419) - 0.5) * 0.35;
  }
  const coarse = coherent01(point, [2, 2, 2], seed, 211) - 0.5;
  const fine = coherent01(point, [1, 1, 1], seed, 307) - 0.5;
  return coarse * 0.44 + fine * 0.24;
};

/** Compute deterministic height offset in [-0.3, +0.15] for structural patterns. */
export const patternHeightOffset = (
  lx: number,
  ly: number,
  width: number,
  height: number,
  pattern: NormalPatternKind,
): number => {
  if (pattern === 'none') return 0;
  if (pattern === 'seam') {
    return lx === 0 || ly === 0 || lx === width - 1 || ly === height - 1 ? -0.24 : 0.06;
  }
  if (pattern === 'plank') {
    const row = Math.floor(ly / 4);
    const seamY = ly % 4 === 0;
    const jointX = (lx + row * 5) % 8 === 0;
    return seamY || jointX ? -0.26 : 0.08;
  }
  if (pattern === 'brick') {
    const row = Math.floor(ly / 4);
    const shift = (row & 1) * 4;
    const mortar = ly % 4 === 0 || (lx + shift) % 8 === 0;
    return mortar ? -0.28 : 0.1;
  }
  const grout = lx % 4 === 0 || ly % 4 === 0;
  return grout ? -0.24 : 0.09;
};

const sampleClamped = (
  heights: Float32Array,
  atlasWidth: number,
  x: number,
  y: number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
): number => {
  const cx = Math.max(xMin, Math.min(xMax, x));
  const cy = Math.max(yMin, Math.min(yMax, y));
  return heights[cy * atlasWidth + cx] ?? 0.5;
};

const scharrAt = (
  heights: Float32Array,
  atlasWidth: number,
  x: number,
  y: number,
  bounds: NormalRegionBounds,
): readonly [number, number] => {
  const xMin = bounds.x;
  const xMax = bounds.x + bounds.width - 1;
  const yMin = bounds.y;
  const yMax = bounds.y + bounds.height - 1;
  const h00 = sampleClamped(heights, atlasWidth, x - 1, y - 1, xMin, xMax, yMin, yMax);
  const h01 = sampleClamped(heights, atlasWidth, x, y - 1, xMin, xMax, yMin, yMax);
  const h02 = sampleClamped(heights, atlasWidth, x + 1, y - 1, xMin, xMax, yMin, yMax);
  const h10 = sampleClamped(heights, atlasWidth, x - 1, y, xMin, xMax, yMin, yMax);
  const h12 = sampleClamped(heights, atlasWidth, x + 1, y, xMin, xMax, yMin, yMax);
  const h20 = sampleClamped(heights, atlasWidth, x - 1, y + 1, xMin, xMax, yMin, yMax);
  const h21 = sampleClamped(heights, atlasWidth, x, y + 1, xMin, xMax, yMin, yMax);
  const h22 = sampleClamped(heights, atlasWidth, x + 1, y + 1, xMin, xMax, yMin, yMax);
  const du = (3 * (h02 - h00) + 10 * (h12 - h10) + 3 * (h22 - h20)) / 32;
  const dv = (3 * (h20 - h00) + 10 * (h21 - h01) + 3 * (h22 - h02)) / 32;
  return [du, dv];
};

const quantizeNormalComponent = (value: number): number => {
  const clamped = Math.max(-1, Math.min(1, value));
  const bin = Math.round(Math.sign(clamped) * Math.sqrt(Math.abs(clamped)) * 7);
  const unit = bin / 7;
  return Math.sign(unit) * unit * unit;
};

const encodeNormalPixel = (
  rgba: Uint8Array,
  offset: number,
  du: number,
  dv: number,
  scale: number,
): boolean => {
  const tx = -scale * du;
  const ty = -scale * dv;
  const rawInvLen = 1 / Math.hypot(tx, ty, 1);
  // Quantize to <= 15x15 = 225 unit pairs so encodeCanonicalPng emits indexed PLTE PNGs.
  const qx = quantizeNormalComponent(tx * rawInvLen);
  const qy = quantizeNormalComponent(ty * rawInvLen);
  const qz = Math.sqrt(Math.max(0.04, 1 - qx * qx - qy * qy));
  const invLen = 1 / Math.hypot(qx, qy, qz);
  const r = clampByte(qx * invLen * 127 + 128);
  const g = clampByte(qy * invLen * 127 + 128);
  const b = clampByte(qz * invLen * 127 + 128);
  rgba[offset] = r;
  rgba[offset + 1] = g;
  rgba[offset + 2] = b;
  rgba[offset + 3] = 255;
  return r !== 128 || g !== 128 || b !== 255;
};

const applyRegionNormals = (
  heights: Float32Array,
  atlasWidth: number,
  atlasHeight: number,
  region: NormalRegionBounds,
  rgba: Uint8Array,
): boolean => {
  if (region.strength <= 0 || region.width <= 0 || region.height <= 0) return false;
  const scale = clamp01(region.strength) * NORMAL_GRADIENT_GAIN;
  const xEnd = Math.min(atlasWidth, region.x + region.width);
  const yEnd = Math.min(atlasHeight, region.y + region.height);
  let hasDetail = false;
  for (let y = Math.max(0, region.y); y < yEnd; y += 1) {
    for (let x = Math.max(0, region.x); x < xEnd; x += 1) {
      const [du, dv] = scharrAt(heights, atlasWidth, x, y, region);
      if (encodeNormalPixel(rgba, (y * atlasWidth + x) * 4, du, dv, scale)) {
        hasDetail = true;
      }
    }
  }
  return hasDetail;
};

/**
 * Apply 3x3 Scharr gradient filter on a scalar height field [0, 1] and encode
 * an OpenGL/glTF tangent-space normal map PNG around RGB (128, 128, 255).
 * Returns undefined when all regions have zero effective strength or flat normals.
 */
export const synthesizeNormalMapPngBase64 = (
  width: number,
  height: number,
  heights: Float32Array,
  regions: readonly NormalRegionBounds[],
): string | undefined => {
  if (width <= 0 || height <= 0 || regions.every((r) => r.strength <= 0)) return undefined;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 128;
    rgba[i + 1] = 128;
    rgba[i + 2] = 255;
    rgba[i + 3] = 255;
  }
  let hasRelief = false;
  for (const region of regions) {
    if (applyRegionNormals(heights, width, height, region, rgba)) hasRelief = true;
  }
  if (!hasRelief) return undefined;
  return encodeBase64Bytes(encodeCanonicalPng(createCanonicalTextureRaster(width, height, rgba)));
};
