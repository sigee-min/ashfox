import type { TextureUsage } from '../../domain/model';
import { summarizeUvUsage } from '../../domain/uv/usageSummary';
import type { TextureTargetSet } from '../../domain/uv/targets';
import type { ToolError } from '../../types';
import type { UvGuardFailure } from './types';

export const needsUvRecovery = (usage: TextureUsage, targets: TextureTargetSet): boolean => {
  const summary = summarizeUvUsage(usage, targets);
  return usage.textures.length === 0 || summary.missingUvFaces > 0;
};

export const classifyUvGuardFailure = (error: ToolError): UvGuardFailure => {
  if (error.code !== 'invalid_state' && error.code !== 'invalid_payload') return 'unknown';
  const details = error.details;
  if (!details || typeof details !== 'object') return 'unknown';
  const reason = typeof (details as { reason?: string }).reason === 'string'
    ? (details as { reason?: string }).reason
    : null;
  if (reason === 'uv_overlap') return 'uv_overlap';
  if (reason === 'uv_scale_mismatch') return 'uv_scale_mismatch';
  if (reason === 'uv_usage_mismatch') return 'uv_usage_mismatch';
  if (reason === 'uv_usage_missing') return 'uv_usage_missing';
  const overlaps = (details as { overlaps?: unknown[] }).overlaps;
  const mismatches = (details as { mismatches?: unknown[] }).mismatches;
  if (Array.isArray(overlaps) && overlaps.length > 0) return 'uv_overlap';
  if (Array.isArray(mismatches) && mismatches.length > 0) return 'uv_scale_mismatch';
  const expected = (details as { expected?: unknown }).expected;
  const current = (details as { current?: unknown }).current;
  if (typeof expected === 'string' && typeof current === 'string') return 'uv_usage_mismatch';
  return 'unknown';
};


