import type { UvPaintRect } from '../../domain/uv/paintTypes';
import { clamp } from '../../domain/math';

export type TextureCoverage = {
  opaquePixels: number;
  totalPixels: number;
  opaqueRatio: number;
  bounds?: { x1: number; y1: number; x2: number; y2: number };
};

export const analyzeTextureCoverage = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): TextureCoverage | null => {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  try {
    const image = ctx.getImageData(0, 0, width, height);
    const data = image.data;
    const totalPixels = width * height;
    let opaquePixels = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha === 0) continue;
      opaquePixels += 1;
      const idx = i / 4;
      const x = idx % width;
      const y = Math.floor(idx / width);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const opaqueRatio = totalPixels > 0 ? opaquePixels / totalPixels : 0;
    const bounds =
      opaquePixels > 0
        ? { x1: minX, y1: minY, x2: maxX, y2: maxY }
        : undefined;
    return { opaquePixels, totalPixels, opaqueRatio, bounds };
  } catch (err) {
    return null;
  }
};

export const analyzeTextureCoverageInRects = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  rects: UvPaintRect[]
): TextureCoverage | null => {
  if (!Array.isArray(rects) || rects.length === 0) return null;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  try {
    const mask = new Uint8Array(width * height);
    rects.forEach((rect) => {
      const x1 = clamp(Math.floor(rect.x1), 0, width);
      const x2 = clamp(Math.ceil(rect.x2), 0, width);
      const y1 = clamp(Math.floor(rect.y1), 0, height);
      const y2 = clamp(Math.ceil(rect.y2), 0, height);
      if (x2 <= x1 || y2 <= y1) return;
      for (let y = y1; y < y2; y += 1) {
        const rowStart = y * width + x1;
        const rowEnd = rowStart + (x2 - x1);
        mask.fill(1, rowStart, rowEnd);
      }
    });
    const image = ctx.getImageData(0, 0, width, height);
    const data = image.data;
    let totalPixels = 0;
    let opaquePixels = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let i = 0; i < mask.length; i += 1) {
      if (mask[i] === 0) continue;
      totalPixels += 1;
      const alpha = data[i * 4 + 3];
      if (alpha === 0) continue;
      opaquePixels += 1;
      const x = i % width;
      const y = Math.floor(i / width);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    if (totalPixels === 0) return null;
    const opaqueRatio = totalPixels > 0 ? opaquePixels / totalPixels : 0;
    const bounds =
      opaquePixels > 0
        ? { x1: minX, y1: minY, x2: maxX, y2: maxY }
        : undefined;
    return { opaquePixels, totalPixels, opaqueRatio, bounds };
  } catch (err) {
    return null;
  }
};
