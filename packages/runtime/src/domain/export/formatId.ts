import type { FormatKind } from '@ashfox/contracts/types/internal';
import type { FormatDescriptor } from '../../ports/formats';
import type { SessionState } from '../../session';
import { resolveFormatId, type FormatOverrides } from '../formats';

export const resolveExportFormatId = (
  snapshot: SessionState,
  expectedFormat: FormatKind | null,
  formats: FormatDescriptor[],
  overrides?: FormatOverrides
): string | null => {
  if (snapshot.formatId) return snapshot.formatId;
  if (!expectedFormat) return null;
  return resolveFormatId(expectedFormat, formats, overrides);
};

