import { TEXTURE_CLEANUP_DELETE_REQUIRED, TEXTURE_CLEANUP_ENTRY_REQUIRED, TEXTURE_CLEANUP_FORCE_INVALID, TEXTURE_CLEANUP_INVALID } from '../../../shared/messages';
import { isRecord } from '../../../domain/guards';
import { validationOk } from '../common';
import { errWithCode } from '../../response';
import type { ToolResponse } from '../../../types';

export const validateTextureCleanup = (cleanup: unknown): ToolResponse<void> => {
  if (!isRecord(cleanup)) {
    return errWithCode('invalid_payload', TEXTURE_CLEANUP_INVALID);
  }
  const deletes = cleanup.delete;
  if (!Array.isArray(deletes) || deletes.length === 0) {
    return errWithCode('invalid_payload', TEXTURE_CLEANUP_DELETE_REQUIRED);
  }
  for (const entry of deletes) {
    if (!entry || (!entry.id && !entry.name)) {
      return errWithCode('invalid_payload', TEXTURE_CLEANUP_ENTRY_REQUIRED);
    }
  }
  if (cleanup.force !== undefined && typeof cleanup.force !== 'boolean') {
    return errWithCode('invalid_payload', TEXTURE_CLEANUP_FORCE_INVALID);
  }
  return validationOk();
};
