import type { GenerateTexturePresetPayload, ToolError } from '../../../types';
import { TexturePresetResult, generateTexturePreset } from '../../../domain/texturePresets';
import { resolveUvPaintRects } from '../../../domain/uv/paint';
import { validateUvPaintSpec } from '../../../domain/uv/paintValidation';
import { guardUvUsage } from '../../../domain/uv/guards';
import { collectSingleTarget } from '../../../domain/uv/targets';
import { checkDimensions, mapDimensionError } from '../../../domain/dimensions';
import { requireUvUsageId } from '../../../domain/uv/usageId';
import { ensureNonBlankString } from '../../../shared/payloadValidation';
import { validateUvPaintSourceSize } from '../../../domain/uv/paintSource';
import { normalizeTextureSize } from '../../../domain/textureUtils';
import { resolveTextureUsageEntry } from '../../../domain/textureUsage';
import {
  DIMENSION_INTEGER_MESSAGE,
  DIMENSION_POSITIVE_MESSAGE,
  TEXTURE_ALREADY_EXISTS,
  TEXTURE_PRESET_MODE_INVALID,
  TEXTURE_PRESET_NAME_REQUIRED,
  TEXTURE_PRESET_SIZE_EXCEEDS_MAX,
  TEXTURE_PRESET_SIZE_EXCEEDS_MAX_FIX,
  TEXTURE_PRESET_TARGET_REQUIRED,
  TEXTURE_PRESET_UV_USAGE_REQUIRED,
  TEXTURE_RENDERER_UNAVAILABLE
} from '../../../shared/messages';
import { resolveTextureTarget } from '../../targetResolvers';
import { toDomainSnapshot, toDomainTextureUsage } from '../../domainMappers';
import { fail, ok, type UsecaseResult } from '../../result';
import type { TextureToolContext } from '../context';
import { uvGuardMessages, uvPaintMessages, uvPaintSourceMessages } from '../context';
import type { TextureUsage } from '../../../domain/model';
import type { TexturePresetContext, TextureTarget } from './types';
import type { UvPaintSpec } from '../../../domain/uv/paintSpec';

export const resolveUvPaintSpec = (payload: GenerateTexturePresetPayload): UvPaintSpec =>
  payload.uvPaint ?? { scope: 'rects', mapping: 'stretch' };

export const validateTexturePresetContext = (
  ctx: TextureToolContext,
  payload: GenerateTexturePresetPayload
): UsecaseResult<TexturePresetContext> => {
  if (!ctx.textureRenderer) {
    return fail({ code: 'not_implemented', message: TEXTURE_RENDERER_UNAVAILABLE });
  }
  if (payload.mode && payload.mode !== 'create' && payload.mode !== 'update') {
    return fail({ code: 'invalid_payload', message: TEXTURE_PRESET_MODE_INVALID(payload.mode) });
  }
  const nameBlankErr = ensureNonBlankString(payload.name, 'name');
  if (nameBlankErr) return fail(nameBlankErr);
  const targetIdBlankErr = ensureNonBlankString(payload.targetId, 'targetId');
  if (targetIdBlankErr) return fail(targetIdBlankErr);
  const targetNameBlankErr = ensureNonBlankString(payload.targetName, 'targetName');
  if (targetNameBlankErr) return fail(targetNameBlankErr);
  const mode = payload.mode ?? (payload.targetId || payload.targetName ? 'update' : 'create');
  if (mode === 'create' && !payload.name) {
    return fail({
      code: 'invalid_payload',
      message: TEXTURE_PRESET_NAME_REQUIRED
    });
  }
  let label =
    mode === 'update'
      ? payload.targetName ?? payload.targetId ?? payload.name ?? payload.preset
      : payload.name ?? payload.preset;
  const uvPaintLabel = payload.targetName ?? payload.targetId ?? label;
  const usageIdRes = requireUvUsageId(payload.uvUsageId, { required: TEXTURE_PRESET_UV_USAGE_REQUIRED });
  if (!usageIdRes.ok) return fail(usageIdRes.error);
  const uvUsageId = usageIdRes.data;
  const width = Number(payload.width);
  const height = Number(payload.height);
  const maxSize = ctx.capabilities.limits.maxTextureSize;
  const sizeCheck = checkDimensions(width, height, { requireInteger: true, maxSize });
  if (!sizeCheck.ok) {
    const sizeMessage = mapDimensionError(sizeCheck, {
      nonPositive: (axis) => DIMENSION_POSITIVE_MESSAGE(axis, axis),
      nonInteger: (axis) => DIMENSION_INTEGER_MESSAGE(axis, axis),
      exceedsMax: (limit) => TEXTURE_PRESET_SIZE_EXCEEDS_MAX(limit || maxSize)
    });
    if (sizeCheck.reason === 'exceeds_max') {
      return fail({
        code: 'invalid_payload',
        message: sizeMessage ?? TEXTURE_PRESET_SIZE_EXCEEDS_MAX(maxSize),
        fix: TEXTURE_PRESET_SIZE_EXCEEDS_MAX_FIX(maxSize),
        details: { width, height, maxSize }
      });
    }
    return fail({ code: 'invalid_payload', message: sizeMessage ?? DIMENSION_POSITIVE_MESSAGE('width/height') });
  }
  const uvPaintSpec = resolveUvPaintSpec(payload);
  const uvPaintValidation = validateUvPaintSpec(uvPaintSpec, ctx.capabilities.limits, uvPaintLabel, uvPaintMessages);
  if (!uvPaintValidation.ok) return fail(uvPaintValidation.error);
  const usageRes = ctx.editor.getTextureUsage({});
  if (usageRes.error) return fail(usageRes.error);
  const usageRaw = usageRes.result ?? { textures: [] };
  const usage = toDomainTextureUsage(usageRaw);
  const snapshot = ctx.getSnapshot();
  let target: TextureTarget | null = null;
  if (mode === 'update') {
    const resolved = resolveTextureTarget(snapshot.textures, payload.targetId, payload.targetName, {
      required: { message: TEXTURE_PRESET_TARGET_REQUIRED }
    });
    if (resolved.error) return fail(resolved.error);
    target = resolved.target!;
  }
  if (mode === 'update' && payload.name && payload.name !== target?.name) {
    const conflict = snapshot.textures.some(
      (texture) => texture.name === payload.name && texture.id !== target?.id
    );
    if (conflict) {
      return fail({ code: 'invalid_payload', message: TEXTURE_ALREADY_EXISTS(payload.name) });
    }
  }
  if (mode === 'create' && payload.name) {
    const conflict = snapshot.textures.some((texture) => texture.name === payload.name);
    if (conflict) {
      return fail({ code: 'invalid_payload', message: TEXTURE_ALREADY_EXISTS(payload.name) });
    }
  }
  label = target?.name ?? uvPaintLabel;
  const uvPaintTarget =
    mode === 'update'
      ? { id: target?.id, name: target?.name }
      : { targetId: payload.targetId, targetName: payload.targetName, name: payload.name };
  const targets = collectSingleTarget(uvPaintTarget);
  const resolution = ctx.editor.getProjectTextureResolution() ?? { width, height };
  const domainSnapshot = toDomainSnapshot(snapshot);
  const guardError = guardUvUsage({
    usage,
    cubes: domainSnapshot.cubes,
    expectedUsageId: uvUsageId,
    resolution,
    policy: ctx.getUvPolicyConfig(),
    targets,
    messages: uvGuardMessages
  });
  if (guardError) return fail(guardError);
  const rectRes = resolveUvPaintRects({ ...uvPaintTarget, uvPaint: uvPaintSpec }, usage, uvPaintMessages);
  if (!rectRes.ok) return fail(rectRes.error);
  const sourceRes = validateUvPaintSourceSize(
    Number(uvPaintSpec.source?.width ?? width),
    Number(uvPaintSpec.source?.height ?? height),
    ctx.capabilities.limits,
    uvPaintLabel,
    { requireInteger: true },
    uvPaintSourceMessages
  );
  if (!sourceRes.ok) {
    const reason = sourceRes.error.details?.reason;
    if (reason === 'exceeds_max') {
      return fail({
        ...sourceRes.error,
        fix: `Use width/height <= ${maxSize}.`,
        details: { ...(sourceRes.error.details ?? {}), maxSize }
      });
    }
    return fail(sourceRes.error);
  }
  const sourceWidth = sourceRes.data.width;
  const sourceHeight = sourceRes.data.height;
  const preset: TexturePresetResult = generateTexturePreset({
    preset: payload.preset,
    width: sourceWidth,
    height: sourceHeight,
    seed: payload.seed,
    palette: payload.palette
  });
  return ok({
    label: target?.name ?? label,
    width,
    height,
    uvPaintSpec,
    rects: rectRes.data.rects,
    mode,
    target,
    preset
  });
};

export const resolveRecoveredPresetSize = (
  payload: GenerateTexturePresetPayload,
  recovery: { usage: TextureUsage; resolution?: { width: number; height: number } }
): { width: number; height: number } | null => {
  const recoverySize = normalizeTextureSize(recovery.resolution?.width, recovery.resolution?.height);
  if (recoverySize) return recoverySize;
  const entry = resolveTextureUsageEntry(recovery.usage, {
    targetId: payload.targetId,
    targetName: payload.targetName,
    name: payload.name
  });
  return normalizeTextureSize(entry?.width, entry?.height);
};

export const isUvRecoveryCandidate = (error: ToolError): boolean => {
  if (error.code !== 'invalid_state') return false;
  const details = error.details;
  if (details && typeof details === 'object') {
    const record = details as Record<string, unknown>;
    const reason = typeof record.reason === 'string' ? record.reason : null;
    if (reason && reason.startsWith('uv_')) return true;
    if (Array.isArray(record.overlaps) && record.overlaps.length > 0) return true;
    if (Array.isArray(record.mismatches) && record.mismatches.length > 0) return true;
    if (typeof record.expected === 'string' && typeof record.current === 'string') return true;
  }
  const message = String(error.message ?? '').toLowerCase();
  return message.includes('uv');
};
