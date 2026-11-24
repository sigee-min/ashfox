import { TEXTURE_HEX_COLOR_PATTERN } from '@ashfox/blockbench-contracts/mcpSchemas/schemas/texture';
import {
  clipTextureLineToCanvas,
  createTextureRasterPlan,
  type TextureOpLike,
  type TextureRasterFailureReason,
} from './textureOps';
import { clamp } from './math';

export type Rgba = { r: number; g: number; b: number; a: number };

const HEX_COLOR_PATTERN = new RegExp(TEXTURE_HEX_COLOR_PATTERN);

export const parseHexColor = (value: string): Rgba | null => {
  const raw = String(value ?? '').trim();
  if (!HEX_COLOR_PATTERN.test(raw)) return null;
  const hex = raw.slice(1);
  const n = Number.parseInt(hex, 16);
  if (!Number.isFinite(n)) return null;
  if (hex.length === 6) {
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff, a: 255 };
  }
  return {
    r: (n >> 24) & 0xff,
    g: (n >> 16) & 0xff,
    b: (n >> 8) & 0xff,
    a: n & 0xff,
  };
};

export const fillPixels = (data: Uint8ClampedArray, width: number, height: number, color: Rgba) => {
  const total = width * height;
  for (let i = 0; i < total; i += 1) {
    const idx = i * 4;
    data[idx] = color.r;
    data[idx + 1] = color.g;
    data[idx + 2] = color.b;
    data[idx + 3] = color.a;
  }
};

export const applyTextureOps = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  ops: readonly unknown[],
  resolveColor: (value: string) => Rgba | null,
):
  | { ok: true }
  | {
      ok: false;
      opIndex: number;
      reason: 'invalid_color' | 'invalid_line_width' | TextureRasterFailureReason;
    } => {
  const plan = createTextureRasterPlan(ops, width, height);
  if (!plan.ok) return plan;
  for (let i = 0; i < plan.ops.length; i += 1) {
    const op = plan.ops[i];
    const color = resolveColor(op.color);
    if (!color) return { ok: false, opIndex: i, reason: 'invalid_color' };
    switch (op.op) {
      case 'set_pixel':
        setPixel(data, width, height, Math.round(op.x), Math.round(op.y), color);
        break;
      case 'fill_rect':
        fillRect(data, width, height, op.x, op.y, op.width, op.height, color);
        break;
      case 'draw_rect': {
        const lineWidth = Math.max(1, Math.trunc(op.lineWidth ?? 1));
        if (!Number.isFinite(lineWidth) || lineWidth <= 0) {
          return { ok: false, opIndex: i, reason: 'invalid_line_width' };
        }
        strokeRect(data, width, height, op.x, op.y, op.width, op.height, lineWidth, color);
        break;
      }
      case 'draw_line': {
        const lineWidth = Math.max(1, Math.trunc(op.lineWidth ?? 1));
        if (!Number.isFinite(lineWidth) || lineWidth <= 0) {
          return { ok: false, opIndex: i, reason: 'invalid_line_width' };
        }
        drawLine(data, width, height, op, lineWidth, color);
        break;
      }
      default:
        return { ok: false, opIndex: i, reason: 'invalid_op' };
    }
  }
  return { ok: true };
};

const setPixel = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  color: Rgba,
) => {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const idx = (y * width + x) * 4;
  data[idx] = color.r;
  data[idx + 1] = color.g;
  data[idx + 2] = color.b;
  data[idx + 3] = color.a;
};

const fillRect = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  w: number,
  h: number,
  color: Rgba,
) => {
  const xStart = clamp(Math.floor(x), 0, width);
  const yStart = clamp(Math.floor(y), 0, height);
  const xEnd = clamp(Math.ceil(x + w), 0, width);
  const yEnd = clamp(Math.ceil(y + h), 0, height);
  if (xEnd <= xStart || yEnd <= yStart) return;
  for (let yy = yStart; yy < yEnd; yy += 1) {
    for (let xx = xStart; xx < xEnd; xx += 1) {
      setPixel(data, width, height, xx, yy, color);
    }
  }
};

const strokeRect = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  w: number,
  h: number,
  lineWidth: number,
  color: Rgba,
) => {
  if (w <= 0 || h <= 0) return;
  fillRect(data, width, height, x, y, w, lineWidth, color);
  fillRect(data, width, height, x, y + h - lineWidth, w, lineWidth, color);
  fillRect(data, width, height, x, y + lineWidth, lineWidth, h - 2 * lineWidth, color);
  fillRect(
    data,
    width,
    height,
    x + w - lineWidth,
    y + lineWidth,
    lineWidth,
    h - 2 * lineWidth,
    color,
  );
};

const drawLine = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  op: Extract<TextureOpLike, { op: 'draw_line' }>,
  lineWidth: number,
  color: Rgba,
) => {
  const clipped = clipTextureLineToCanvas(op, width, height);
  if (!clipped) return;
  let x = Math.round(clipped.x1);
  let y = Math.round(clipped.y1);
  const xEnd = Math.round(clipped.x2);
  const yEnd = Math.round(clipped.y2);
  const dx = Math.abs(xEnd - x);
  const dy = Math.abs(yEnd - y);
  const sx = x < xEnd ? 1 : -1;
  const sy = y < yEnd ? 1 : -1;
  let err = dx - dy;
  const radius = Math.max(0, Math.floor(lineWidth / 2));
  while (true) {
    drawBrush(data, width, height, x, y, radius, color);
    if (x === xEnd && y === yEnd) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
};

const drawBrush = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
  color: Rgba,
) => {
  if (radius <= 0) {
    setPixel(data, width, height, x, y, color);
    return;
  }
  const yStart = Math.max(0, y - radius);
  const yEnd = Math.min(height - 1, y + radius);
  const xStart = Math.max(0, x - radius);
  const xEnd = Math.min(width - 1, x + radius);
  for (let yy = yStart; yy <= yEnd; yy += 1) {
    for (let xx = xStart; xx <= xEnd; xx += 1) {
      setPixel(data, width, height, xx, yy, color);
    }
  }
};
