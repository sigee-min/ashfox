export type DomainErrorCode =
  | 'unsupported_format'
  | 'not_implemented'
  | 'invalid_state'
  | 'invalid_payload'
  | 'no_change'
  | 'io_error'
  | 'unknown';

export type DomainError = {
  code: DomainErrorCode;
  message: string;
  details?: Record<string, unknown>;
};

export type DomainResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: DomainError };

export const ok = <T>(data: T): DomainResult<T> => ({ ok: true, data });

export const fail = <T = never>(
  code: DomainErrorCode,
  message: string,
  details?: Record<string, unknown>
): DomainResult<T> => ({
  ok: false,
  error: { code, message, ...(details ? { details } : {}) }
});
