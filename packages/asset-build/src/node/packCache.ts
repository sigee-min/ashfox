import type { DirectoryPack } from '@ashfox/engine-core';
import { compareText } from '@ashfox/internal-contracts';
import type { Artifact, CatalogAsset, PackEncoder } from '../bundle/contract';
import { compilePack } from '../packs/compile';
import { digest, json } from '../shared/digest';
import { readCacheBinary, writeCacheBinary, type DiskCacheContext } from './diskCache';
import { createVorbisEncoder, VORBIS_FINGERPRINT } from './vorbis';

interface CachedPackMeta {
  readonly files: readonly { readonly path: string; readonly sha256: string }[];
}

export interface PackArtifactWithHash extends Artifact {
  readonly sha256?: string;
}

const packInputRefs = (pack: DirectoryPack): readonly string[] => {
  if (pack.format === 'minecraft_java') {
    const refs = [
      ...(pack.icon ? [pack.icon] : []),
      ...pack.models,
      ...pack.items.map((item) => item.source),
      ...pack.sounds.map((sound) => sound.source),
    ];
    return [...new Set(refs)].sort(compareText);
  }
  return [...new Set(pack.assets.map((asset) => asset.source))].sort(compareText);
};

const packUsesVorbis = (pack: DirectoryPack): boolean =>
  pack.format === 'minecraft_java' ? pack.sounds.length > 0 : pack.audio === 'ogg';

const packCacheKey = (
  pack: DirectoryPack,
  assetsById: ReadonlyMap<string, CatalogAsset>,
  usesVorbis: boolean,
  cache: DiskCacheContext,
): string => {
  const inputs = packInputRefs(pack).map((id) => {
    const asset = assetsById.get(id);
    if (!asset) return undefined;
    return {
      ...asset,
      files: asset.files.filter((f) => !f.path.endsWith('/ashfox-lineage.json')),
    };
  });
  return `pack-${digest(json({ pack, inputs, vorbis: usesVorbis ? VORBIS_FINGERPRINT : '' }))}-${cache.fingerprint}`;
};

const wrapEncoderWithCache = (encoder: PackEncoder, cache: DiskCacheContext): PackEncoder => ({
  fingerprint: encoder.fingerprint,
  encode: async (wav) => {
    const oggKey = `ogg-${digest(wav)}-${encoder.fingerprint}`;
    const hit = readCacheBinary<{ readonly ok: true }>(cache, oggKey);
    if (hit && hit.blobs.length === 1) return hit.blobs[0]!;
    const encoded = await encoder.encode(wav);
    writeCacheBinary(cache, oggKey, { ok: true }, [encoded]);
    return encoded;
  },
});

export const compileNodePackWithCache = async (
  pack: DirectoryPack,
  assets: readonly CatalogAsset[],
  artifacts: readonly Artifact[],
  cache: DiskCacheContext,
  getEncoder: () => Promise<PackEncoder>,
): Promise<readonly PackArtifactWithHash[]> => {
  const assetsById = new Map(assets.map((a) => [a.id, a]));
  const usesVorbis = packUsesVorbis(pack);
  const key = packCacheKey(pack, assetsById, usesVorbis, cache);
  const cached = readCacheBinary<CachedPackMeta>(cache, key);
  if (cached && cached.meta.files.length === cached.blobs.length) {
    return cached.meta.files.map((entry, idx) => ({
      path: entry.path,
      bytes: cached.blobs[idx]!,
      sha256: entry.sha256,
    }));
  }
  const encoder = usesVorbis ? wrapEncoderWithCache(await getEncoder(), cache) : undefined;
  const compiled = await compilePack(pack, assets, artifacts, encoder);
  const withHashes: PackArtifactWithHash[] = compiled.map((file) => ({
    path: file.path,
    bytes: file.bytes,
    sha256: digest(file.bytes),
  }));
  writeCacheBinary(
    cache,
    key,
    { files: withHashes.map((file) => ({ path: file.path, sha256: file.sha256! })) },
    withHashes.map((file) => file.bytes),
  );
  return withHashes;
};

export const createLazyVorbisGetter = (signal?: AbortSignal): (() => Promise<PackEncoder>) => {
  let promise: Promise<PackEncoder> | null = null;
  return () => {
    if (!promise) promise = createVorbisEncoder(signal);
    return promise;
  };
};
