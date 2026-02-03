import type { ToolError } from '../types';
import { resolveTargetByIdOrName, resolveTargetLabel } from './sessionLookup';
import type { IdNameMismatchMessage } from './payloadValidation';
import { ensureIdNameMatch, ensureIdOrName } from './payloadValidation';

type TargetNamed = { id?: string | null; name: string };

type ResolveTargetOptions = {
  required: { message: string; fix?: string };
  mismatch?: {
    kind: string;
    plural: string;
    idLabel?: string;
    nameLabel?: string;
    message?: IdNameMismatchMessage;
  };
  notFound: (label: string) => string;
};

export const resolveTargetOrError = <T extends TargetNamed>(
  items: T[],
  id: string | undefined,
  name: string | undefined,
  options: ResolveTargetOptions
): { target?: T; error?: ToolError } => {
  const requiredErr = ensureIdOrName(id, name, options.required);
  if (requiredErr) return { error: requiredErr };
  if (options.mismatch) {
    const mismatchErr = ensureIdNameMatch(items, id, name, options.mismatch);
    if (mismatchErr) return { error: mismatchErr };
  }
  const target = resolveTargetByIdOrName(items, id, name);
  if (!target) {
    return {
      error: { code: 'invalid_payload', message: options.notFound(resolveTargetLabel(id, name)) }
    };
  }
  return { target };
};



