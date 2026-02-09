import type { Capabilities, FormatKind } from '@ashfox/contracts/types/internal';
import type { SessionState } from '../../session';
import { matchesFormatKind } from '../formats';
import type { MatchOverrideKind } from './snapshotResolution';

export type ExportFormatGuardResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'format_not_enabled';
      format: FormatKind;
    };

export type ExportSnapshotGuardResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'format_mismatch';
      needsOverrideHint: boolean;
    };

export const ensureExportFormatEnabled = (
  capabilities: Capabilities,
  expectedFormat: FormatKind | null
): ExportFormatGuardResult => {
  if (!expectedFormat) return { ok: true };
  const formatCapability = capabilities.formats.find((entry) => entry.format === expectedFormat);
  if (!formatCapability || !formatCapability.enabled) {
    return { ok: false, reason: 'format_not_enabled', format: expectedFormat };
  }
  return { ok: true };
};

export const ensureSnapshotMatchesExportFormat = (
  snapshot: SessionState,
  expectedFormat: FormatKind | null,
  matchOverrideKind: MatchOverrideKind
): ExportSnapshotGuardResult => {
  if (!expectedFormat) return { ok: true };
  if (snapshot.format && snapshot.format !== expectedFormat) {
    return { ok: false, reason: 'format_mismatch', needsOverrideHint: false };
  }
  if (
    !snapshot.format &&
    snapshot.formatId &&
    !matchesFormatKind(expectedFormat, snapshot.formatId) &&
    matchOverrideKind(snapshot.formatId) !== expectedFormat
  ) {
    return { ok: false, reason: 'format_mismatch', needsOverrideHint: true };
  }
  return { ok: true };
};

