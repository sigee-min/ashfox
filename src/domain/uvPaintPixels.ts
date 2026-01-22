import type { DomainResult } from './result';
import { UvPaintRect } from './uvPaint';

export type UvPaintPixelConfig = {
  rects: UvPaintRect[];
  mapping: 'stretch' | 'tile';
  padding: number;
  anchor: [number, number];
};

export const applyUvPaintPixels = (input: {
  source: { width: number; height: number; data: Uint8ClampedArray };
  target: { width: number; height: number };
  config: UvPaintPixelConfig;
  label: string;
}): DomainResult<{ data: Uint8ClampedArray; rects: UvPaintRect[] }> => {
  const { source, target, config, label } = input;
  if (!Array.isArray(config.rects) || config.rects.length === 0) {
    return err('invalid_payload', `uvPaint requires at least one rect (${label})`);
  }
  const sourceWidth = Math.trunc(source.width);
  const sourceHeight = Math.trunc(source.height);
  const targetWidth = Math.trunc(target.width);
  const targetHeight = Math.trunc(target.height);
  if (sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) {
    return err('invalid_payload', `uvPaint requires positive source/target sizes (${label})`);
  }
  if (source.data.length !== sourceWidth * sourceHeight * 4) {
    return err('invalid_payload', `uvPaint source data size mismatch (${label})`);
  }
  const normalized = normalizePaintRects(config.rects, config.padding, targetWidth, targetHeight, label);
  if (!normalized.ok) return normalized;
  const rects = normalized.data;
  const out = new Uint8ClampedArray(targetWidth * targetHeight * 4);
  const mapping = config.mapping ?? 'stretch';
  const anchor = Array.isArray(config.anchor) ? config.anchor : [0, 0];
  if (mapping === 'tile') {
    const [anchorX, anchorY] = anchor;
    rects.forEach((rect) => {
      const xStart = clamp(Math.floor(rect.x1), 0, targetWidth);
      const xEnd = clamp(Math.ceil(rect.x2), 0, targetWidth);
      const yStart = clamp(Math.floor(rect.y1), 0, targetHeight);
      const yEnd = clamp(Math.ceil(rect.y2), 0, targetHeight);
      for (let y = yStart; y < yEnd; y += 1) {
        const sy = mod(Math.floor(y - anchorY), sourceHeight);
        for (let x = xStart; x < xEnd; x += 1) {
          const sx = mod(Math.floor(x - anchorX), sourceWidth);
          copyPixel(source.data, sourceWidth, out, targetWidth, sx, sy, x, y);
        }
      }
    });
    return { ok: true, data: { data: out, rects } };
  }
  rects.forEach((rect) => {
    const rectWidth = rect.x2 - rect.x1;
    const rectHeight = rect.y2 - rect.y1;
    if (rectWidth <= 0 || rectHeight <= 0) return;
    const xStart = clamp(Math.floor(rect.x1), 0, targetWidth);
    const xEnd = clamp(Math.ceil(rect.x2), 0, targetWidth);
    const yStart = clamp(Math.floor(rect.y1), 0, targetHeight);
    const yEnd = clamp(Math.ceil(rect.y2), 0, targetHeight);
    for (let y = yStart; y < yEnd; y += 1) {
      const v = (y + 0.5 - rect.y1) / rectHeight;
      const sy = clamp(Math.floor(v * sourceHeight), 0, sourceHeight - 1);
      for (let x = xStart; x < xEnd; x += 1) {
        const u = (x + 0.5 - rect.x1) / rectWidth;
        const sx = clamp(Math.floor(u * sourceWidth), 0, sourceWidth - 1);
        copyPixel(source.data, sourceWidth, out, targetWidth, sx, sy, x, y);
      }
    }
  });
  return { ok: true, data: { data: out, rects } };
};

const normalizePaintRects = (
  rects: UvPaintRect[],
  padding: number,
  width: number,
  height: number,
  label: string
): DomainResult<UvPaintRect[]> => {
  const safePadding = Number.isFinite(padding) ? Math.max(0, padding) : 0;
  const normalized: UvPaintRect[] = [];
  for (const rect of rects) {
    const x1 = Math.min(rect.x1, rect.x2) + safePadding;
    const y1 = Math.min(rect.y1, rect.y2) + safePadding;
    const x2 = Math.max(rect.x1, rect.x2) - safePadding;
    const y2 = Math.max(rect.y1, rect.y2) - safePadding;
    if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
      return err('invalid_payload', `uvPaint rect is invalid (${label})`);
    }
    if (x2 <= x1 || y2 <= y1) {
      return err('invalid_payload', `uvPaint padding exceeds rect size (${label})`);
    }
    if (x1 < 0 || y1 < 0 || x2 > width || y2 > height) {
      return err('invalid_payload', `uvPaint rect is outside texture bounds (${label})`);
    }
    normalized.push({ x1, y1, x2, y2 });
  }
  return { ok: true, data: normalized };
};

const copyPixel = (
  source: Uint8ClampedArray,
  sourceWidth: number,
  target: Uint8ClampedArray,
  targetWidth: number,
  sx: number,
  sy: number,
  tx: number,
  ty: number
) => {
  const sIdx = (sy * sourceWidth + sx) * 4;
  const tIdx = (ty * targetWidth + tx) * 4;
  target[tIdx] = source[sIdx];
  target[tIdx + 1] = source[sIdx + 1];
  target[tIdx + 2] = source[sIdx + 2];
  target[tIdx + 3] = source[sIdx + 3];
};

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const mod = (value: number, modulus: number): number => {
  const result = value % modulus;
  return result < 0 ? result + modulus : result;
};

const err = (code: 'invalid_payload', message: string): DomainResult<never> => ({
  ok: false,
  error: { code, message }
});
