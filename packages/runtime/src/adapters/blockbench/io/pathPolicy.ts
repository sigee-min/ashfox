import { errorMessage } from '../../../logging';

export type FsPathPolicyModule = {
  statSync?: (path: string) => { isDirectory?: () => boolean };
};

export type PathPolicyModule = {
  join?: (...parts: string[]) => string;
};

export const isDirectoryPath = (value: string, fs?: FsPathPolicyModule | null): boolean => {
  if (/[\\/]$/.test(value)) return true;
  const statSync = fs?.statSync;
  if (typeof statSync !== 'function') return false;
  try {
    const stat = statSync(value);
    return typeof stat?.isDirectory === 'function' && Boolean(stat.isDirectory());
  } catch (_err) {
    return false;
  }
};

export const joinPath = (
  base: string,
  fileName: string,
  path?: PathPolicyModule | null
): string => {
  const join = path?.join;
  if (typeof join === 'function') return join(base, fileName);
  return `${base.replace(/[\\/]+$/, '')}/${fileName}`;
};

export const resolveDirectoryAwarePath = (
  targetPath: string,
  defaultFileName: string,
  fs?: FsPathPolicyModule | null,
  path?: PathPolicyModule | null
): string => {
  if (isDirectoryPath(targetPath, fs)) return joinPath(targetPath, defaultFileName, path);
  return targetPath;
};

export const isEisdirError = (err: unknown): boolean => {
  const code = (err as { code?: unknown })?.code;
  if (code === 'EISDIR') return true;
  const message = errorMessage(err, '').toLowerCase();
  return message.includes('eisdir') || message.includes('is a directory');
};

