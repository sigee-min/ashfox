import { textureOpSchema } from '@ashfox/blockbench-contracts/mcpSchemas/schemas/texture';
import { validateSchema } from '@ashfox/blockbench-contracts/mcpSchemas/validation';
import type { TextureOpLike } from '@ashfox/blockbench-contracts/types/internal';
import { createFiniteJsonSnapshot } from '@ashfox/internal-contracts';

export type { TextureOpLike } from '@ashfox/blockbench-contracts/types/internal';

export const MAX_TEXTURE_OPS = 4096;
export const TEXTURE_RASTER_MIN_WORK_BUDGET = 262_144;
export const TEXTURE_RASTER_CANVAS_WORK_MULTIPLIER = 4;

export type TextureRasterFailureReason = 'invalid_op' | 'raster_work_exceeded';

export type ClippedTextureLine = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

type TextureRasterPlan =
  | { ok: true; ops: TextureOpLike[]; work: number; budget: number }
  | { ok: false; opIndex: number; reason: TextureRasterFailureReason };

export const isTextureOp = (op: unknown): op is TextureOpLike =>
  validateSchema(textureOpSchema, op).ok;

const clippedRectArea = (
  x: number,
  y: number,
  width: number,
  height: number,
  canvasWidth: number,
  canvasHeight: number,
): number => {
  const xStart = Math.max(0, Math.floor(x));
  const yStart = Math.max(0, Math.floor(y));
  const xEnd = Math.min(canvasWidth, Math.ceil(x + width));
  const yEnd = Math.min(canvasHeight, Math.ceil(y + height));
  if (xEnd <= xStart || yEnd <= yStart) return 0;
  return (xEnd - xStart) * (yEnd - yStart);
};

const clipLineToBounds = (
  line: ClippedTextureLine,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): ClippedTextureLine | null => {
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  const p = [-dx, dx, -dy, dy];
  const q = [line.x1 - minX, maxX - line.x1, line.y1 - minY, maxY - line.y1];
  let start = 0;
  let end = 1;
  for (let index = 0; index < p.length; index += 1) {
    const divisor = p[index];
    const distance = q[index];
    if (divisor === 0) {
      if (distance < 0) return null;
      continue;
    }
    const ratio = distance / divisor;
    if (divisor < 0) {
      start = Math.max(start, ratio);
    } else {
      end = Math.min(end, ratio);
    }
    if (start > end) return null;
  }
  return {
    x1: line.x1 + start * dx,
    y1: line.y1 + start * dy,
    x2: line.x1 + end * dx,
    y2: line.y1 + end * dy,
  };
};

export const clipTextureLineToCanvas = (
  op: Extract<TextureOpLike, { op: 'draw_line' }>,
  canvasWidth: number,
  canvasHeight: number,
): ClippedTextureLine | null => {
  const lineWidth = Math.max(1, Math.trunc(op.lineWidth ?? 1));
  const radius = Math.max(0, Math.floor(lineWidth / 2));
  return clipLineToBounds(
    { x1: op.x1, y1: op.y1, x2: op.x2, y2: op.y2 },
    -radius,
    -radius,
    canvasWidth - 1 + radius,
    canvasHeight - 1 + radius,
  );
};

const estimateTextureOpWork = (
  op: TextureOpLike,
  canvasWidth: number,
  canvasHeight: number,
): number => {
  switch (op.op) {
    case 'set_pixel':
      return 1;
    case 'fill_rect':
      return clippedRectArea(op.x, op.y, op.width, op.height, canvasWidth, canvasHeight);
    case 'draw_rect': {
      const lineWidth = Math.max(1, Math.trunc(op.lineWidth ?? 1));
      return (
        clippedRectArea(op.x, op.y, op.width, lineWidth, canvasWidth, canvasHeight) +
        clippedRectArea(
          op.x,
          op.y + op.height - lineWidth,
          op.width,
          lineWidth,
          canvasWidth,
          canvasHeight,
        ) +
        clippedRectArea(
          op.x,
          op.y + lineWidth,
          lineWidth,
          op.height - 2 * lineWidth,
          canvasWidth,
          canvasHeight,
        ) +
        clippedRectArea(
          op.x + op.width - lineWidth,
          op.y + lineWidth,
          lineWidth,
          op.height - 2 * lineWidth,
          canvasWidth,
          canvasHeight,
        )
      );
    }
    case 'draw_line': {
      const clipped = clipTextureLineToCanvas(op, canvasWidth, canvasHeight);
      if (!clipped) return 0;
      const steps =
        Math.ceil(Math.max(Math.abs(clipped.x2 - clipped.x1), Math.abs(clipped.y2 - clipped.y1))) +
        1;
      const lineWidth = Math.max(1, Math.trunc(op.lineWidth ?? 1));
      const diameter = 2 * Math.floor(lineWidth / 2) + 1;
      const brushWork = Math.min(canvasWidth * canvasHeight, diameter * diameter);
      return steps * brushWork;
    }
  }
};

export const createTextureRasterPlan = (
  inputOps: readonly unknown[],
  canvasWidth: number,
  canvasHeight: number,
): TextureRasterPlan => {
  if (
    !Number.isSafeInteger(canvasWidth) ||
    !Number.isSafeInteger(canvasHeight) ||
    canvasWidth <= 0 ||
    canvasHeight <= 0
  ) {
    return { ok: false, opIndex: 0, reason: 'invalid_op' };
  }
  const canvasArea = canvasWidth * canvasHeight;
  const budget = Math.max(
    TEXTURE_RASTER_MIN_WORK_BUDGET,
    canvasArea * TEXTURE_RASTER_CANVAS_WORK_MULTIPLIER,
  );
  const ops: TextureOpLike[] = [];
  let work = 0;
  for (let opIndex = 0; opIndex < inputOps.length; opIndex += 1) {
    const snapshot = createFiniteJsonSnapshot(inputOps[opIndex]);
    if (!snapshot.ok || !isTextureOp(snapshot.value)) {
      return { ok: false, opIndex, reason: 'invalid_op' };
    }
    const op = snapshot.value;
    work += estimateTextureOpWork(op, canvasWidth, canvasHeight);
    if (!Number.isSafeInteger(work) || work > budget) {
      return { ok: false, opIndex, reason: 'raster_work_exceeded' };
    }
    ops.push(op);
  }
  return { ok: true, ops, work, budget };
};
