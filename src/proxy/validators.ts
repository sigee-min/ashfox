import { ApplyModelSpecPayload, ApplyTextureSpecPayload, TextureOp } from '../spec';
import { resolveTextureSpecSize } from './texture';
import { Limits, ToolResponse } from '../types';
import { buildRigTemplate } from '../templates';
import { isZeroSize } from '../domain/geometry';
import { err } from './response';
import { validateUvPaintSpec } from '../domain/uvPaint';

const MAX_TEX_OPS = 4096;

export const validateModelSpec = (payload: ApplyModelSpecPayload, limits: Limits): ToolResponse<unknown> => {
  if (!payload.model) return err('invalid_payload', 'model is required');
  const inputParts = payload.model.parts ?? [];
  if (!Array.isArray(inputParts)) return err('invalid_payload', 'parts must be an array');
  const rigTemplate = payload.model.rigTemplate ?? 'empty';
  if (!['empty', 'biped', 'quadruped', 'block_entity'].includes(rigTemplate)) {
    return err('invalid_payload', `unknown rigTemplate: ${rigTemplate}`);
  }
  const templatedParts = buildRigTemplate(rigTemplate, inputParts);
  const cubeCount = templatedParts.filter((part) => !isZeroSize(part.size)).length;
  if (inputParts.length === 0 && templatedParts.length === 0) {
    return err(
      'invalid_payload',
      'parts or rigTemplate must provide parts (set model.rigTemplate or supply model.parts with id/size/offset).'
    );
  }
  if (cubeCount > limits.maxCubes) return err('invalid_payload', `too many parts (>${limits.maxCubes})`);
  const ids = new Set<string>();
  for (const p of inputParts) {
    if (!p.id) return err('invalid_payload', 'part id required');
    if (ids.has(p.id)) return err('invalid_payload', `duplicate part id: ${p.id}`);
    ids.add(p.id);
    if (!Array.isArray(p.size) || p.size.length !== 3) return err('invalid_payload', `size invalid for ${p.id}`);
    if (!Array.isArray(p.offset) || p.offset.length !== 3) return err('invalid_payload', `offset invalid for ${p.id}`);
  }
  for (const p of templatedParts) {
    if (!Array.isArray(p.size) || p.size.length !== 3) return err('invalid_payload', `size invalid for ${p.id}`);
    if (!Array.isArray(p.offset) || p.offset.length !== 3) return err('invalid_payload', `offset invalid for ${p.id}`);
  }
  return { ok: true, data: { valid: true } };
};

export const validateTextureSpec = (payload: ApplyTextureSpecPayload, limits: Limits): ToolResponse<unknown> => {
  if (!payload || !Array.isArray(payload.textures) || payload.textures.length === 0) {
    return err('invalid_payload', 'textures array is required');
  }
  if (typeof payload.uvUsageId !== 'string' || payload.uvUsageId.trim().length === 0) {
    return err('invalid_payload', 'uvUsageId is required. Call preflight_texture before apply_texture_spec.');
  }
  for (const tex of payload.textures) {
    const label = tex?.name ?? tex?.targetName ?? tex?.targetId ?? 'texture';
    const mode = tex?.mode ?? 'create';
    if (mode !== 'create' && mode !== 'update') {
      return err('invalid_payload', `unsupported texture mode ${mode} (${label})`);
    }
    if (mode === 'create' && !tex?.name) {
      return err('invalid_payload', `texture name is required (${label})`);
    }
    if (mode === 'update' && !tex?.targetId && !tex?.targetName) {
      return err('invalid_payload', `targetId or targetName is required (${label})`);
    }
    const size = resolveTextureSpecSize(tex);
    if (!Number.isFinite(size.width) || size.width <= 0) {
      return err('invalid_payload', `texture width must be > 0 (${label})`);
    }
    if (!Number.isFinite(size.height) || size.height <= 0) {
      return err('invalid_payload', `texture height must be > 0 (${label})`);
    }
    if (Number.isFinite(size.width) && Number.isFinite(size.height)) {
      if (size.width > limits.maxTextureSize || size.height > limits.maxTextureSize) {
        return err('invalid_payload', `texture size exceeds max ${limits.maxTextureSize} (${label})`);
      }
    }
    const ops = Array.isArray(tex.ops) ? tex.ops : [];
    if (ops.length > MAX_TEX_OPS) {
      return err('invalid_payload', `too many texture ops (>${MAX_TEX_OPS}) (${label})`);
    }
    for (const op of ops) {
      if (!isTextureOp(op)) {
        return err('invalid_payload', `invalid texture op (${label})`);
      }
    }
    if (tex.uvPaint !== undefined) {
      const uvPaintRes = validateUvPaintSpec(tex.uvPaint, limits, label);
      if (!uvPaintRes.ok) return uvPaintRes;
    }
  }
  return { ok: true, data: { valid: true } };
};

const isTextureOp = (op: unknown): op is TextureOp => {
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

const isFiniteNumber = (value: unknown): value is number => Number.isFinite(value);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
