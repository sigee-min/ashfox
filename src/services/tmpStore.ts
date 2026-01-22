import { ToolError } from '../types';

type FsModule = {
  mkdirSync: (path: string, options?: { recursive?: boolean }) => void;
  writeFileSync: (path: string, data: Uint8Array) => void;
};

type PathModule = {
  join: (...parts: string[]) => string;
  resolve: (...parts: string[]) => string;
};

type TmpSaveResult = {
  path: string;
  mimeType: string;
  byteLength: number;
};

declare const requireNativeModule:
  | ((name: string, options: { message: string; detail?: string; optional?: boolean }) => unknown)
  | undefined;
declare const require: ((name: string) => unknown) | undefined;

const loadModule = <T>(name: string): T | null => {
  if (typeof requireNativeModule === 'function') {
    try {
      const mod = requireNativeModule(name, {
        message: 'bbmcp needs filesystem access to store image snapshots.',
        optional: true
      });
      if (mod) return mod as T;
    } catch {
      // fall through
    }
  }
  if (typeof require === 'function') {
    try {
      return require(name) as T;
    } catch {
      return null;
    }
  }
  return null;
};

const sanitizeName = (value: string): string =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);

const guessExtension = (mimeType: string): string => {
  switch (mimeType) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    default:
      return 'bin';
  }
};

const parseDataUri = (dataUri: string): { mimeType: string; base64: string } | null => {
  const raw = String(dataUri ?? '');
  const match = /^data:([^;]+);base64,(.+)$/i.exec(raw);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
};

export const saveDataUriToTmp = (
  dataUri: string,
  options?: { nameHint?: string; prefix?: string; cwd?: string }
): { ok: true; data: TmpSaveResult } | { ok: false; error: ToolError } => {
  const parsed = parseDataUri(dataUri);
  if (!parsed) {
    return { ok: false, error: { code: 'invalid_payload', message: 'Invalid dataUri for image snapshot.' } };
  }
  const fs = loadModule<FsModule>('fs');
  const path = loadModule<PathModule>('path');
  if (!fs || !path) {
    return { ok: false, error: { code: 'not_implemented', message: 'Filesystem access unavailable.' } };
  }
  const root = options?.cwd ?? (typeof process !== 'undefined' && process.cwd ? process.cwd() : '.');
  const baseDir = path.resolve(root, '.bbmcp', 'tmp');
  try {
    fs.mkdirSync(baseDir, { recursive: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create tmp directory.';
    return { ok: false, error: { code: 'io_error', message } };
  }
  const prefix = sanitizeName(options?.prefix ?? 'image');
  const nameHint = sanitizeName(options?.nameHint ?? '');
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const ext = guessExtension(parsed.mimeType);
  const baseName = nameHint || prefix || 'image';
  const fileName = `${baseName}_${stamp}_${rand}.${ext}`;
  const filePath = path.join(baseDir, fileName);
  let buffer: Uint8Array;
  try {
    buffer = Buffer.from(parsed.base64, 'base64');
  } catch (err) {
    return { ok: false, error: { code: 'invalid_payload', message: 'Image base64 decode failed.' } };
  }
  try {
    fs.writeFileSync(filePath, buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to write image snapshot.';
    return { ok: false, error: { code: 'io_error', message } };
  }
  return { ok: true, data: { path: filePath, mimeType: parsed.mimeType, byteLength: buffer.byteLength } };
};
