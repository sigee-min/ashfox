import type { DomainError, DomainResult } from '../../result';

/** Canonical UV-atlas failure shape; keep wire-visible details ownership here. */
export const atlasFailure = (
  code: DomainError['code'],
  message: string,
  details?: Record<string, unknown>,
): DomainResult<never> => ({
  ok: false,
  error: { code, message, details },
});
