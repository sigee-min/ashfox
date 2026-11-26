import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { threadId } from 'node:worker_threads';
import { AUDIO_POLICY } from '@ashfox/audio-core';
import { ASHFOX_WORKSPACE_COMPILER_FINGERPRINT, SPRITE_POLICY } from '@ashfox/engine-core';
import { compareText } from '@ashfox/internal-contracts';
import { digest, json } from '../shared/digest';
import { noLinks } from './paths';

const CACHE_SCHEMA_VERSION = 'ashfox-disk-cache:v1';
const BINARY_MAGIC = Buffer.from('ASHFCAC1', 'ascii');
const CACHE_KEY_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/u;

let memoizedCompilerDigest: string | null = null;
let tempSequence = 0;

export interface NodeBuildOptions {
  readonly noCache?: boolean;
  readonly cacheDir?: string;
  readonly compilerInvalidator?: string;
}

export interface DiskCacheContext {
  readonly enabled: boolean;
  readonly directory: string;
  readonly fingerprint: string;
}

const collectTsFiles = (directory: string, out: string[]): void => {
  if (!fs.existsSync(directory)) return;
  const entries = fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => compareText(a.name, b.name));
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) collectTsFiles(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(full);
  }
};

const hashCompilerSources = (assetBuildNodeDir: string): string => {
  const packagesRoot = path.resolve(assetBuildNodeDir, '../../..');
  const roots = [
    path.join(packagesRoot, 'asset-build/src'),
    path.join(packagesRoot, 'audio-core/src'),
    path.join(packagesRoot, 'engine-core/src'),
    path.join(packagesRoot, 'internal-contracts/src'),
  ];
  const files: string[] = [];
  for (const root of roots) collectTsFiles(root, files);
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(path.relative(packagesRoot, file));
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
};

export const computeCompilerDigest = (): string => {
  if (memoizedCompilerDigest !== null) return memoizedCompilerDigest;
  const selfFile = __filename;
  if (selfFile.endsWith('.ts')) {
    memoizedCompilerDigest = hashCompilerSources(path.dirname(selfFile));
  } else {
    memoizedCompilerDigest = crypto
      .createHash('sha256')
      .update(fs.readFileSync(selfFile))
      .digest('hex');
  }
  return memoizedCompilerDigest;
};

export const computeCompilerFingerprint = (toolchain: string, invalidator?: string): string => {
  const envInvalidator = process.env.ASHFOX_CACHE_INVALIDATOR ?? '';
  return digest(
    json({
      schema: CACHE_SCHEMA_VERSION,
      compiler: ASHFOX_WORKSPACE_COMPILER_FINGERPRINT,
      audio: AUDIO_POLICY,
      sprite: SPRITE_POLICY,
      code: computeCompilerDigest(),
      node: process.version,
      toolchain,
      invalidator: invalidator ?? envInvalidator,
    }),
  );
};

export const isDiskCacheDisabled = (options?: NodeBuildOptions): boolean =>
  Boolean(options?.noCache) || process.env.ASHFOX_NO_CACHE === '1';

export const createDiskCache = (
  root: string,
  toolchain: string,
  options?: NodeBuildOptions,
): DiskCacheContext => {
  const directory = options?.cacheDir ?? path.join(root, '.ashfox-cache');
  const enabled = !isDiskCacheDisabled(options);
  if (enabled) noLinks(directory);
  return {
    enabled,
    directory,
    fingerprint: computeCompilerFingerprint(toolchain, options?.compilerInvalidator),
  };
};

const cacheFilePath = (cache: DiskCacheContext, key: string, ext: string): string => {
  const safeKey = CACHE_KEY_RE.test(key) ? key : digest(key);
  return path.join(cache.directory, `${safeKey}.${ext}`);
};

const writeFileAtomic = (directory: string, target: string, payload: Buffer | string): void => {
  try {
    fs.mkdirSync(directory, { recursive: true });
    const tmp = path.join(
      directory,
      `.tmp-${process.pid}-${threadId}-${tempSequence++}-${crypto.randomUUID()}.part`,
    );
    try {
      fs.writeFileSync(tmp, payload);
      fs.renameSync(tmp, target);
    } finally {
      if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
    }
  } catch {
    // Ignore cache write errors on read-only workspaces; compilation output remains valid.
  }
};

export const readCacheJson = <T>(cache: DiskCacheContext, key: string): T | null => {
  if (!cache.enabled) return null;
  const target = cacheFilePath(cache, key, 'json');
  try {
    if (!fs.existsSync(target)) return null;
    if (fs.lstatSync(target).isSymbolicLink()) return null;
    return JSON.parse(fs.readFileSync(target, 'utf8')) as T;
  } catch {
    return null;
  }
};

export const writeCacheJson = (cache: DiskCacheContext, key: string, value: unknown): void => {
  if (!cache.enabled) return;
  const target = cacheFilePath(cache, key, 'json');
  writeFileAtomic(cache.directory, target, JSON.stringify(value));
};

const encodeBinaryEnvelope = (meta: unknown, blobs: readonly Uint8Array[]): Buffer => {
  const metaBuf = Buffer.from(JSON.stringify(meta), 'utf8');
  const headerSize = 16 + blobs.length * 4;
  let totalBlobs = 0;
  for (const blob of blobs) totalBlobs += blob.byteLength;
  const out = Buffer.allocUnsafe(headerSize + metaBuf.byteLength + totalBlobs);
  BINARY_MAGIC.copy(out, 0);
  out.writeUInt32LE(metaBuf.byteLength, 8);
  out.writeUInt32LE(blobs.length, 12);
  let offset = 16;
  for (const blob of blobs) {
    out.writeUInt32LE(blob.byteLength, offset);
    offset += 4;
  }
  metaBuf.copy(out, offset);
  offset += metaBuf.byteLength;
  for (const blob of blobs) {
    Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength).copy(out, offset);
    offset += blob.byteLength;
  }
  return out;
};

const decodeBinaryEnvelope = <M>(
  raw: Buffer,
): { readonly meta: M; readonly blobs: readonly Uint8Array[] } | null => {
  if (raw.byteLength < 16 || !raw.subarray(0, 8).equals(BINARY_MAGIC)) return null;
  const metaLen = raw.readUInt32LE(8);
  const blobCount = raw.readUInt32LE(12);
  const headerSize = 16 + blobCount * 4;
  if (raw.byteLength < headerSize + metaLen) return null;
  const lengths: number[] = [];
  let totalBlobs = 0;
  for (let i = 0; i < blobCount; i++) {
    const len = raw.readUInt32LE(16 + i * 4);
    lengths.push(len);
    totalBlobs += len;
  }
  if (headerSize + metaLen + totalBlobs !== raw.byteLength) return null;
  const meta = JSON.parse(raw.subarray(headerSize, headerSize + metaLen).toString('utf8')) as M;
  const blobs: Uint8Array[] = [];
  let offset = headerSize + metaLen;
  for (const len of lengths) {
    blobs.push(raw.subarray(offset, offset + len));
    offset += len;
  }
  return { meta, blobs };
};

export const readCacheBinary = <M>(
  cache: DiskCacheContext,
  key: string,
): { readonly meta: M; readonly blobs: readonly Uint8Array[] } | null => {
  if (!cache.enabled) return null;
  const target = cacheFilePath(cache, key, 'bin');
  try {
    if (!fs.existsSync(target)) return null;
    if (fs.lstatSync(target).isSymbolicLink()) return null;
    return decodeBinaryEnvelope<M>(fs.readFileSync(target));
  } catch {
    return null;
  }
};

export const writeCacheBinary = (
  cache: DiskCacheContext,
  key: string,
  meta: unknown,
  blobs: readonly Uint8Array[],
): void => {
  if (!cache.enabled) return;
  const target = cacheFilePath(cache, key, 'bin');
  writeFileAtomic(cache.directory, target, encodeBinaryEnvelope(meta, blobs));
};
