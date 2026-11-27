import { suggestClosest } from '@ashfox/internal-contracts';

export const SOUND_DOCS_HINT = "Hint: run 'ashfox docs sound'";

export const soundDidYouMean = (unknown: string, candidates: readonly string[]): string => {
  const best = suggestClosest(unknown, candidates);
  return best === null ? '' : ` Did you mean "${best}"?`;
};

export class SoundSyntaxError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

export class SoundError extends Error {
  constructor(
    readonly path: string,
    readonly detail: string,
    readonly hint?: string,
  ) {
    super(`sound.invalid: ${path}: ${detail}`);
  }
}

export const fail = (path: string, detail: string, hint = SOUND_DOCS_HINT): never => {
  throw new SoundError(path, detail, hint);
};

export const closed = (
  value: unknown,
  keys: readonly string[],
  path: string,
  optional: readonly string[] = [],
): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail(path, 'expected record');
  const record = value as Record<string, unknown>;
  const allowedList = [...keys, ...optional];
  const allowed = new Set(allowedList);
  for (const key of Object.keys(record))
    if (!allowed.has(key))
      fail(`${path}.${key}`, `unknown field${soundDidYouMean(key, allowedList)}`);
  for (const key of keys) if (!Object.hasOwn(record, key)) fail(`${path}.${key}`, 'missing field');
  return record;
};

export const number = (
  value: unknown,
  min: number,
  max: number,
  path: string,
  integer = false,
): number => {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    return fail(
      path,
      `expected ${integer ? 'integer ' : ''}${min}..${max}; received ${String(value)}`,
    );
  return value;
};

export const bool = (value: unknown, path: string): boolean => {
  if (typeof value !== 'boolean') return fail(path, `expected boolean; received ${String(value)}`);
  return value;
};

export const choice = <T extends string>(
  value: unknown,
  choices: readonly T[],
  path: string,
): T => {
  if (typeof value !== 'string' || !choices.includes(value as T)) {
    const suggestion = typeof value === 'string' ? soundDidYouMean(value, choices) : '';
    return fail(path, `expected ${choices.join(' | ')}; received ${String(value)}${suggestion}`);
  }
  return value as T;
};

export const list = (value: unknown, min: number, max: number, path: string): unknown[] => {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    return fail(
      path,
      `expected ${min}..${max} entries; received ${Array.isArray(value) ? value.length : typeof value}`,
    );
  return value;
};

export const id = (value: unknown, path: string, ids?: Set<string>): string => {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/u.test(value) || ids?.has(value))
    return fail(path, `invalid or duplicate identifier ${String(value)}`);
  ids?.add(value);
  return value;
};

export const freeze = (value: unknown): unknown => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

export const ordered = (
  values: readonly unknown[],
): readonly { readonly raw: unknown; readonly index: number }[] =>
  values
    .map((raw, index) => ({ raw, index }))
    .sort((a, b) => {
      const name = (value: unknown): string => {
        if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string')
          return '';
        return value.id;
      };
      const left = name(a.raw),
        right = name(b.raw);
      return left < right ? -1 : left > right ? 1 : a.index - b.index;
    });
