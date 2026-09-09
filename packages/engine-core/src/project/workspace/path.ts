import { utf8ContractByteLength } from '@ashfox/internal-contracts';

import { DEFAULT_WORKSPACE_LIMITS } from './limits';

export type WorkspacePathErrorCode =
  | 'workspace.path.type'
  | 'workspace.path.empty'
  | 'workspace.path.utf16'
  | 'workspace.path.nfc'
  | 'workspace.path.length'
  | 'workspace.path.absolute'
  | 'workspace.path.separator'
  | 'workspace.path.segment'
  | 'workspace.path.control'
  | 'workspace.path.whitespace';

export class WorkspacePathError extends Error {
  readonly code: WorkspacePathErrorCode;

  constructor(code: WorkspacePathErrorCode, message: string) {
    super(message);
    this.name = 'WorkspacePathError';
    this.code = code;
  }
}

export class WorkspaceTextError extends Error {
  readonly code: 'workspace.source.type' | 'workspace.source.utf16' |
    'workspace.source.bom' | 'workspace.source.utf8';

  constructor(
    code: 'workspace.source.type' | 'workspace.source.utf16' |
      'workspace.source.bom' | 'workspace.source.utf8',
    message: string
  ) {
    super(message);
    this.name = 'WorkspaceTextError';
    this.code = code;
  }
}

export const isWellFormedUtf16 = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
};

export const assertWellFormedSourceText = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw new WorkspaceTextError(
      'workspace.source.type',
      'Workspace source must be a string.'
    );
  }
  if (!isWellFormedUtf16(value)) {
    throw new WorkspaceTextError(
      'workspace.source.utf16',
      'Workspace source contains an unpaired UTF-16 surrogate.'
    );
  }
  if (value.startsWith('\uFEFF')) {
    throw new WorkspaceTextError(
      'workspace.source.bom',
      'Workspace source must be UTF-8 text without a leading BOM.'
    );
  }
  return value;
};

/** Decode bytes once at the source boundary and reject lossy UTF-8 recovery. */
export const decodeUtf8Source = (input: ArrayLike<number>): string => {
  const bytes = input instanceof Uint8Array ? input : Uint8Array.from(input);
  let value: string;
  try {
    value = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
      .decode(bytes);
  } catch (_error) {
    throw new WorkspaceTextError(
      'workspace.source.utf8',
      'Workspace source contains invalid UTF-8.'
    );
  }
  const checked = assertWellFormedSourceText(value);
  const roundTrip = new TextEncoder().encode(checked);
  if (roundTrip.length !== bytes.length ||
      roundTrip.some((byte, index) => byte !== bytes[index])) {
    throw new WorkspaceTextError(
      'workspace.source.utf8',
      'Workspace source did not round-trip as UTF-8.'
    );
  }
  return checked;
};

const hasControlOrForbiddenPathCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x20 || codePoint === 0x7f ||
        character === '\\' || character === ':' || character === '?' ||
        character === '#' || character === '%' || character === '*' ||
        character === '[' || character === ']' || character === '{' ||
        character === '}') return true;
  }
  return false;
};

const validatePath = (
  value: unknown,
  options: { readonly allowEmpty: boolean; readonly maxCodeUnits: number }
): string => {
  if (typeof value !== 'string') {
    throw new WorkspacePathError(
      'workspace.path.type',
      'Logical paths must be strings.'
    );
  }
  if (value.length === 0) {
    if (options.allowEmpty) return value;
    throw new WorkspacePathError(
      'workspace.path.empty',
      'Logical paths must not be empty.'
    );
  }
  if (!isWellFormedUtf16(value)) {
    throw new WorkspacePathError(
      'workspace.path.utf16',
      'Logical paths must not contain unpaired UTF-16 surrogates.'
    );
  }
  if (value.normalize('NFC') !== value) {
    throw new WorkspacePathError(
      'workspace.path.nfc',
      'Logical paths must already be NFC-normalized.'
    );
  }
  if (value.length > options.maxCodeUnits) {
    throw new WorkspacePathError(
      'workspace.path.length',
      `Logical paths may contain at most ${options.maxCodeUnits} code units.`
    );
  }
  if (value.startsWith('/') || value.endsWith('/')) {
    throw new WorkspacePathError(
      'workspace.path.absolute',
      'Logical paths must be relative and must not end with a slash.'
    );
  }
  if (value.includes('//')) {
    throw new WorkspacePathError(
      'workspace.path.separator',
      'Logical paths must not contain repeated separators.'
    );
  }
  if (hasControlOrForbiddenPathCharacter(value) || value.trim() !== value) {
    throw new WorkspacePathError(
      value.trim() === value ? 'workspace.path.control' :
        'workspace.path.whitespace',
      'Logical paths contain a forbidden control, separator, or URL character.'
    );
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment.length === 0 ||
      segment === '.' || segment === '..')) {
    throw new WorkspacePathError(
      'workspace.path.segment',
      'Logical paths must not contain empty, dot, or parent segments.'
    );
  }
  return value;
};

export const normalizeLogicalPath = (
  value: string,
  maxCodeUnits = DEFAULT_WORKSPACE_LIMITS.maxPathCodeUnits
): string => validatePath(value, { allowEmpty: false, maxCodeUnits });

/** Package roots may be the workspace root, while source paths may not. */
export const normalizePackageRoot = (
  value: string,
  maxCodeUnits = DEFAULT_WORKSPACE_LIMITS.maxPathCodeUnits
): string => validatePath(value, { allowEmpty: true, maxCodeUnits });

export const normalizeRelativePath = (
  value: string,
  maxCodeUnits = DEFAULT_WORKSPACE_LIMITS.maxPathCodeUnits
): string => {
  if (value.startsWith('/') || value.startsWith('./') ||
      value.startsWith('../') || value === '.' || value === '..') {
    throw new WorkspacePathError(
      'workspace.path.absolute',
      'Manifest paths must be normalized relative paths.'
    );
  }
  return validatePath(value, { allowEmpty: false, maxCodeUnits });
};

export const joinLogicalPath = (
  root: string,
  relative: string,
  maxCodeUnits = DEFAULT_WORKSPACE_LIMITS.maxPathCodeUnits
): string => normalizeLogicalPath(
  root.length === 0 ? relative : `${root}/${relative}`,
  maxCodeUnits
);

export const isLogicalPath = (value: unknown): value is string => {
  try {
    if (typeof value !== 'string') return false;
    normalizeLogicalPath(value);
    return true;
  } catch (_error) {
    return false;
  }
};

export const assertUniqueLogicalPaths = (
  paths: readonly string[]
): void => {
  const exact = new Set<string>();
  const folded = new Map<string, string>();
  for (const path of paths) {
    if (exact.has(path)) {
      throw new WorkspacePathError(
        'workspace.path.segment',
        `Duplicate logical path: ${path}`
      );
    }
    exact.add(path);
    // Logical package/source identities use ASCII case folding only. Unicode
    // paths remain NFC-strict and are never locale-folded implicitly.
    const key = path.replace(/[A-Z]/gu, (letter) => letter.toLowerCase());
    const prior = folded.get(key);
    if (prior !== undefined && prior !== path) {
      throw new WorkspacePathError(
        'workspace.path.segment',
        `Case-colliding logical paths: ${prior} and ${path}`
      );
    }
    folded.set(key, path);
  }
};

export const sourceByteLength = (source: string): number =>
  utf8ContractByteLength(assertWellFormedSourceText(source));
