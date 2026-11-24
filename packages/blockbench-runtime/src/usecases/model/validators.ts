import type { ToolError } from '@ashfox/blockbench-contracts/types/internal';
import { ensureNonBlankString } from '../../shared/payloadValidation';

export const ensureNonBlankFields = (entries: Array<[unknown, string]>): ToolError | null => {
  for (const [value, label] of entries) {
    const err = ensureNonBlankString(value, label);
    if (err) return err;
  }
  return null;
};
