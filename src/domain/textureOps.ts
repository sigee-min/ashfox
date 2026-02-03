export const MAX_TEXTURE_OPS = 4096;

import { isFiniteNumber, isRecord } from './guards';

export type TextureOpLike =
  | { op: 'set_pixel'; x: number; y: number; color: string }
  | { op: 'fill_rect'; x: number; y: number; width: number; height: number; color: string }
  | { op: 'draw_rect'; x: number; y: number; width: number; height: number; color: string; lineWidth?: number }
  | { op: 'draw_line'; x1: number; y1: number; x2: number; y2: number; color: string; lineWidth?: number };

export const isTextureOp = (op: unknown): op is TextureOpLike => {
  if (!isRecord(op) || typeof op.op !== 'string') return false;
  switch (op.op) {
    case 'set_pixel':
      return isFiniteNumber(op.x) && isFiniteNumber(op.y) && typeof op.color === 'string';
    case 'fill_rect':
    case 'draw_rect':
      return (
        isFiniteNumber(op.x) &&
        isFiniteNumber(op.y) &&
        isFiniteNumber(op.width) &&
        isFiniteNumber(op.height) &&
        typeof op.color === 'string'
      );
    case 'draw_line':
      return (
        isFiniteNumber(op.x1) &&
        isFiniteNumber(op.y1) &&
        isFiniteNumber(op.x2) &&
        isFiniteNumber(op.y2) &&
        typeof op.color === 'string'
      );
    default:
      return false;
  }
};



