import { loadNativeModule } from '../nativeModules';

export type GuideLoader = (name: string, fallback: string) => string;

type FsModule = {
  existsSync: (path: string) => boolean;
  statSync: (path: string) => { mtimeMs?: number; mtime?: Date; isFile?: () => boolean };
  readFileSync: (path: string, encoding: string) => string;
};

type PathModule = {
  resolve: (...parts: string[]) => string;
};

type GuideCacheEntry = { text: string; mtimeMs: number };

const guideCache = new Map<string, GuideCacheEntry>();

const resolveGuidePath = (path: PathModule, name: string): string => {
  const root = typeof process !== 'undefined' && process.cwd ? process.cwd() : '.';
  return path.resolve(root, 'docs', 'guides', `${name}.md`);
};

const resolveMtimeMs = (stat: { mtimeMs?: number; mtime?: Date }): number => {
  if (typeof stat.mtimeMs === 'number') return stat.mtimeMs;
  if (stat.mtime instanceof Date) return stat.mtime.getTime();
  return 0;
};

const readGuideEntry = (args: {
  fs: FsModule;
  path: PathModule;
  name: string;
}): GuideCacheEntry | null => {
  const filePath = resolveGuidePath(args.path, args.name);
  if (!args.fs.existsSync(filePath)) return null;
  try {
    const stat = args.fs.statSync(filePath);
    if (typeof stat.isFile === 'function' && !stat.isFile()) return null;
    const text = args.fs.readFileSync(filePath, 'utf-8');
    return { text, mtimeMs: resolveMtimeMs(stat) };
  } catch (_err) {
    return null;
  }
};

const resolveCachedGuide = (args: {
  fs: FsModule;
  path: PathModule;
  name: string;
}): GuideCacheEntry | null => {
  const cached = guideCache.get(args.name);
  if (!cached) return null;
  const filePath = resolveGuidePath(args.path, args.name);
  if (!args.fs.existsSync(filePath)) return null;
  try {
    const stat = args.fs.statSync(filePath);
    if (typeof stat.isFile === 'function' && !stat.isFile()) return null;
    const mtimeMs = resolveMtimeMs(stat);
    if (mtimeMs === cached.mtimeMs) return cached;
  } catch (_err) {
    return null;
  }
  return null;
};

export const loadGuideMarkdown: GuideLoader = (name, fallback) => {
  const fs = loadNativeModule<FsModule>('fs', { message: 'Filesystem access required', optional: true });
  const path = loadNativeModule<PathModule>('path', { message: 'Filesystem access required', optional: true });
  if (!fs || !path) return fallback;

  const cached = resolveCachedGuide({ fs, path, name });
  if (cached) return cached.text;

  const entry = readGuideEntry({ fs, path, name });
  if (entry) {
    guideCache.set(name, entry);
    return entry.text;
  }

  guideCache.delete(name);
  return fallback;
};
