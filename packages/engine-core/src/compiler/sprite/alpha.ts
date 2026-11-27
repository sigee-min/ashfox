import type { SpritePatch } from '../../project/sprite/contract';
import { parseSurfaceColor } from '../../textures/color';
import { assertTextureDimensions } from '../../textures/limits';
import { createCanonicalRaster } from './raster';

const HEX_DIGITS = '0123456789abcdef';

const hexByte = (hex: string, offset: number): number =>
  Number.parseInt(hex.slice(offset, offset + 2), 16);

const toByteHex = (v: number): string => {
  const clamped = Math.max(0, Math.min(255, Math.round(v)));
  return HEX_DIGITS[clamped >>> 4]! + HEX_DIGITS[clamped & 15]!;
};

export interface ParsedSpriteHex {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** Parse `#rrggbb` (alpha=255) or `#rrggbbaa` into 8-bit RGBA components. */
export const parseSpriteHex = (hex: string): ParsedSpriteHex => ({
  r: hexByte(hex, 1),
  g: hexByte(hex, 3),
  b: hexByte(hex, 5),
  a: hex.length === 9 ? hexByte(hex, 7) : 255,
});

/** Format RGB + 8-bit alpha as `#rrggbb` (when opaque) or `#rrggbbaa`. */
export const formatSpriteHex = (r: number, g: number, b: number, a: number): string => {
  const alphaByte = Math.max(0, Math.min(255, Math.round(a)));
  const rgb = '#' + toByteHex(r) + toByteHex(g) + toByteHex(b);
  return alphaByte >= 255 ? rgb : rgb + toByteHex(alphaByte);
};

/** Multiply an existing sprite hex color's alpha by a normalized factor in [0, 1]. */
export const scaleHexAlpha = (hex: string, alphaFactor: number): string | null => {
  if (alphaFactor >= 1 && hex.length === 7) return hex;
  const parsed = parseSpriteHex(hex);
  const nextAlpha = Math.round(parsed.a * Math.max(0, Math.min(1, alphaFactor)));
  if (nextAlpha <= 0) return null;
  return formatSpriteHex(parsed.r, parsed.g, parsed.b, nextAlpha);
};

/** Composite `srcHex` over `dstHex` using Porter-Duff source-over alpha blending. */
export const blendCellHex = (dstHex: string | null, srcHex: string | null): string | null => {
  if (srcHex === null) return null;
  const src = parseSpriteHex(srcHex);
  if (src.a <= 0) return dstHex;
  if (dstHex === null || src.a >= 255) return srcHex;
  const dst = parseSpriteHex(dstHex);
  const sa = src.a / 255;
  const da = (dst.a / 255) * (1 - sa);
  const outA = sa + da;
  if (outA <= 0) return null;
  return formatSpriteHex(
    (src.r * sa + dst.r * da) / outA,
    (src.g * sa + dst.g * da) / outA,
    (src.b * sa + dst.b * da) / outA,
    outA * 255,
  );
};

const minMaskEdgeDist = (
  mask: Uint8Array,
  w: number,
  h: number,
  px: number,
  py: number,
  radius: number,
): number => {
  let minDist = radius + 1;
  const y0 = py - radius;
  const y1 = py + radius;
  const x0 = px - radius;
  const x1 = px + radius;
  for (let ny = y0; ny <= y1; ny += 1) {
    for (let nx = x0; nx <= x1; nx += 1) {
      const outside = nx < 0 || ny < 0 || nx >= w || ny >= h || mask[ny * w + nx] === 0;
      if (!outside) continue;
      const dist = Math.hypot(px - nx, py - ny);
      if (dist < minDist) minDist = dist;
    }
  }
  return minDist;
};

/** Compute inward Euclidean feather weights in [0, 1] for a binary sprite mask. */
export const computeFeatherMask = (
  mask: Uint8Array,
  w: number,
  h: number,
  feather: number,
): Float32Array => {
  const weights = new Float32Array(w * h);
  const radius = Math.ceil(feather);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!mask[y * w + x]) continue;
      const d = minMaskEdgeDist(mask, w, h, x, y, radius);
      weights[y * w + x] = Math.max(0, Math.min(1, d / feather));
    }
  }
  return weights;
};

/** Compute binary protection mask around sprite patches. */
export const buildProtectedMask = (
  patches: readonly SpritePatch[],
  w: number,
  h: number,
): Uint8Array => {
  const mask = new Uint8Array(w * h);
  for (const p of patches) {
    const pw = p.rows[0]!.length,
      ph = p.rows.length;
    for (
      let y = Math.max(0, p.at[1] - p.protect);
      y < Math.min(h, p.at[1] + ph + p.protect);
      y += 1
    ) {
      for (
        let x = Math.max(0, p.at[0] - p.protect);
        x < Math.min(w, p.at[0] + pw + p.protect);
        x += 1
      ) {
        mask[y * w + x] = 1;
      }
    }
  }
  return mask;
};

/** Encode compiled sprite hex cells (`#rrggbb` / `#rrggbbaa`) into a CanonicalTextureRaster. */
export const toCanonicalRaster = (cells: readonly (string | null)[], w: number, h: number) => {
  assertTextureDimensions(w, h, 'Canonical texture');
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < cells.length; i += 1) {
    const color = cells[i];
    if (color === null || color === undefined) continue;
    const offset = i * 4;
    if (color.length === 9) {
      const { r, g, b, a } = parseSpriteHex(color);
      rgba[offset] = r;
      rgba[offset + 1] = g;
      rgba[offset + 2] = b;
      rgba[offset + 3] = a;
    } else {
      const { r, g, b } = parseSurfaceColor(color);
      rgba[offset] = r;
      rgba[offset + 1] = g;
      rgba[offset + 2] = b;
      rgba[offset + 3] = 255;
    }
  }
  return createCanonicalRaster(w, h, rgba);
};
