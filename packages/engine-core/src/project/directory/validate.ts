import type { DirectoryExport } from './contract';
import { SpriteInputError } from '../sprite/contract';

/** Throws a closed workspace configuration error with JSON pointer context. */
export const failWorkspaceConfig = (pointer: string, expected: string, actual: unknown): never => {
  throw new SpriteInputError({
    code: 'workspace.config',
    file: '.ashfoxworkspace',
    pointer,
    expected,
    actual: String(actual),
  });
};

/** Validates a closed plain object with an exact set of own keys. */
export const readClosedRecord = (
  value: unknown,
  keys: readonly string[],
  pointer: string,
): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return failWorkspaceConfig(pointer, 'record', value);
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== keys.length ||
    keys.some((key) => !Object.hasOwnProperty.call(record, key))
  ) {
    failWorkspaceConfig(pointer, keys.join(','), Object.keys(record));
  }
  return record;
};

/** Validates an array value at a workspace configuration pointer. */
export const readConfigList = (value: unknown, pointer: string): readonly unknown[] => {
  if (!Array.isArray(value)) return failWorkspaceConfig(pointer, 'array', value);
  return value;
};

/** Validates non-empty bounded configuration text. */
export const readConfigText = (value: unknown, pointer: string): void => {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) {
    failWorkspaceConfig(pointer, 'nonempty text, at most 256 characters', value);
  }
};

/** Validates a namespaced resource identifier (`namespace:path/to/item`). */
export const readResourceId = (value: unknown, pointer: string): void => {
  if (
    typeof value !== 'string' ||
    value.length > 160 ||
    !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(value)
  ) {
    failWorkspaceConfig(pointer, 'namespace:relative/resource', value);
  }
  const [namespace, path] = (value as string).split(':');
  const invalidPart = (part: string): boolean => !part || part === '.' || part === '..';
  if (namespace === '.' || namespace === '..' || path!.split('/').some(invalidPart)) {
    failWorkspaceConfig(pointer, 'namespace:relative/resource', value);
  }
};

/** Checks a nonnegative 16-bit safe integer. */
export const isPackInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 65535;

/** Validates a named export reference matching one of the allowed formats. */
export const readExportSource = (
  value: unknown,
  exports: readonly DirectoryExport[],
  formats: readonly string[],
  pointer: string,
): void => {
  const matches = (entry: DirectoryExport): boolean =>
    entry.name === value && formats.includes(entry.format);
  if (typeof value !== 'string' || !exports.some(matches)) {
    failWorkspaceConfig(pointer, 'named export of format ' + formats.join('|'), value);
  }
};
