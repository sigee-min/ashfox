import type { SoundProduct } from '@ashfox/audio-core';
import { sha256Digest, type GlbPerformanceMetrics } from '@ashfox/engine-core';
import { compareText, encodeUtf8 } from '@ashfox/internal-contracts';
import {
  BuildFailure,
  type Artifact,
  type AssetMetadata,
  type CatalogAsset,
  type CompiledBundle,
  type Snapshot,
} from '../bundle/contract';
import { digest, json } from '../shared/digest';
import { safeRelative } from '../shared/path';
import { readCacheBinary, writeCacheBinary, type DiskCacheContext } from './diskCache';
import { entrySelectorKey, type PlannedEntry, type WorkspaceExecutionPlan } from './entryPlan';
import { compileNodePackWithCache, createLazyVorbisGetter } from './packCache';
import { VORBIS_FINGERPRINT } from './vorbis';
import type { PackageInterfaceDigest, TargetExportSpec, TargetOutput } from './workerTask';

export interface TargetFileWithHash extends Artifact {
  readonly sha256?: string;
}

export interface ResolvedBuildEntry {
  readonly entry: PlannedEntry;
  readonly productKind: 'model' | 'sprite' | 'sound' | 'structure';
  readonly metadata: AssetMetadata;
  readonly sounds?: readonly SoundProduct[];
  readonly hooksJson?: string;
  readonly targets: readonly (Omit<TargetOutput, 'files'> & {
    readonly files: readonly TargetFileWithHash[];
  })[];
  readonly pkgInterfaces?: readonly PackageInterfaceDigest[];
}

interface CachedFileMeta {
  readonly path: string;
  readonly byteCount: number;
  readonly sha256?: string;
}

interface CachedBuildEntry {
  readonly productKind: 'model' | 'sprite' | 'structure';
  readonly metadata: AssetMetadata;
  readonly pkgInterfaces?: readonly PackageInterfaceDigest[];
  readonly targets: readonly {
    readonly targetName: string;
    readonly files: readonly CachedFileMeta[];
    readonly lineageTemplate?: Record<string, unknown>;
    readonly performance?: GlbPerformanceMetrics;
  }[];
}

interface CachedSoundEntry {
  readonly metadata: AssetMetadata;
  readonly sounds: readonly Omit<SoundProduct, 'wav'>[];
  readonly wavHashes?: readonly string[];
  readonly hooksJson?: string;
}

export const requiresVorbisEncoder = (snapshot: Snapshot): boolean =>
  Boolean(
    snapshot.config.packs?.some((pack) =>
      pack.format === 'minecraft_java'
        ? pack.sounds.length > 0
        : pack.audio === 'ogg' &&
          pack.assets.some((a) =>
            snapshot.config.exports.some((e) => e.name === a.source && e.format === 'wav'),
          ),
    ),
  );

const readCachedSpriteEntry = (
  entry: PlannedEntry,
  targets: readonly TargetExportSpec[],
  cache: DiskCacheContext,
): ResolvedBuildEntry | null => {
  const hit = readCacheBinary<CachedBuildEntry>(
    cache,
    `b-spr-${entry.closureHash}-${cache.fingerprint}`,
  );
  const pngBytes = hit?.blobs[0];
  if (!hit || !pngBytes) return null;
  const sha256 = hit.meta.targets[0]?.files[0]?.sha256;
  return {
    entry,
    productKind: hit.meta.productKind,
    metadata: hit.meta.metadata,
    targets: targets.map((t) => ({
      targetName: t.name,
      files: [{ path: `${t.name}.png`, bytes: pngBytes, sha256 }],
    })),
    pkgInterfaces: hit.meta.pkgInterfaces,
  };
};

export const readCachedBuildEntry = (
  entry: PlannedEntry,
  targets: readonly TargetExportSpec[],
  cache: DiskCacheContext,
): ResolvedBuildEntry | null => {
  if (targets.length === 0) return null;
  if (entry.kind === 'sprite') return readCachedSpriteEntry(entry, targets, cache);
  if (entry.kind === 'sound') {
    const hit = readCacheBinary<CachedSoundEntry>(
      cache,
      `b-snd-${entry.closureHash}-${cache.fingerprint}`,
    );
    if (!hit || hit.meta.sounds.length !== hit.blobs.length) return null;
    const sounds: SoundProduct[] = hit.meta.sounds.map((s, idx) => ({
      ...s,
      wav: hit.blobs[idx]!,
    }));
    return {
      entry,
      productKind: 'sound',
      metadata: hit.meta.metadata,
      sounds,
      ...(hit.meta.hooksJson ? { hooksJson: hit.meta.hooksJson } : {}),
      targets: targets.map((t) => ({
        targetName: t.name,
        files: [
          ...sounds.map((s, idx) => ({
            path: `${t.name}/${s.variant}.wav`,
            bytes: s.wav,
            sha256: hit.meta.wavHashes?.[idx],
          })),
          ...(hit.meta.hooksJson
            ? [{ path: `${t.name}.hooks.json`, bytes: encodeUtf8(hit.meta.hooksJson) }]
            : []),
        ],
      })),
    };
  }
  const prefix = entry.kind === 'structure' ? 'b-str' : 'b-mod';
  const hit = readCacheBinary<CachedBuildEntry>(
    cache,
    `${prefix}-${entry.closureHash}-${digest(json(targets))}-${cache.fingerprint}`,
  );
  if (!hit) return null;
  let offset = 0;
  const targetOutputs = hit.meta.targets.map((t) => ({
    targetName: t.targetName,
    files: t.files.map((f) => ({ path: f.path, bytes: hit.blobs[offset++]!, sha256: f.sha256 })),
    lineageTemplate: t.lineageTemplate,
    ...(t.performance ? { performance: t.performance } : {}),
  }));
  return {
    entry,
    productKind: hit.meta.productKind,
    metadata: hit.meta.metadata,
    targets: targetOutputs,
    pkgInterfaces: hit.meta.pkgInterfaces,
  };
};

export const writeCachedBuildEntry = (
  resolved: ResolvedBuildEntry,
  targets: readonly TargetExportSpec[],
  cache: DiskCacheContext,
): void => {
  if (!cache.enabled || targets.length === 0) return;
  if (resolved.productKind === 'sound' && resolved.sounds) {
    const meta: CachedSoundEntry = {
      metadata: resolved.metadata,
      sounds: resolved.sounds.map(({ wav: _wav, ...rest }) => rest),
      wavHashes: resolved.sounds.map((s) => digest(s.wav)),
      ...(resolved.hooksJson ? { hooksJson: resolved.hooksJson } : {}),
    };
    writeCacheBinary(
      cache,
      `b-snd-${resolved.entry.closureHash}-${cache.fingerprint}`,
      meta,
      resolved.sounds.map((s) => s.wav),
    );
    return;
  }
  if (resolved.productKind === 'sound') return;
  const prefix =
    resolved.productKind === 'sprite'
      ? 'b-spr'
      : resolved.productKind === 'structure'
        ? 'b-str'
        : 'b-mod';
  const suffix = resolved.productKind === 'sprite' ? '' : `-${digest(json(targets))}`;
  const blobs: Uint8Array[] = [];
  const cachedTargets = resolved.targets.map((t) => ({
    targetName: t.targetName,
    lineageTemplate: t.lineageTemplate,
    ...(t.performance ? { performance: t.performance } : {}),
    files: t.files.map((f) => {
      blobs.push(f.bytes);
      return { path: f.path, byteCount: f.bytes.byteLength, sha256: f.sha256 ?? digest(f.bytes) };
    }),
  }));
  const meta: CachedBuildEntry = {
    productKind: resolved.productKind,
    metadata: resolved.metadata,
    pkgInterfaces: resolved.pkgInterfaces,
    targets: cachedTargets,
  };
  writeCacheBinary(
    cache,
    `${prefix}-${resolved.entry.closureHash}${suffix}-${cache.fingerprint}`,
    meta,
    blobs,
  );
};

const patchLineageBytes = (
  template: Record<string, unknown>,
  kind: 'model' | 'structure',
  targetName: string,
  buildKey: string,
  modelWorkspaceHash: string,
): Uint8Array => {
  if (kind === 'structure') {
    const digestHex = sha256Digest(`structure:${targetName}:${buildKey}`).replace(/^sha256:/u, '');
    const structureId = `sha256:${digestHex}`;
    return encodeUtf8(
      json({
        ...template,
        workspaceHash: structureId,
        closureHash: structureId,
        buildKey: structureId,
        compilerFingerprint: buildKey,
        productHash: structureId,
      }),
    );
  }
  return encodeUtf8(
    json({
      ...template,
      revision: buildKey,
      workspaceHash: modelWorkspaceHash,
    }),
  );
};

const assembleCatalogAndArtifacts = (
  plan: WorkspaceExecutionPlan,
  resolved: ReadonlyMap<string, ResolvedBuildEntry>,
  modelWorkspaceHash: string,
): {
  readonly assets: CatalogAsset[];
  readonly artifacts: Artifact[];
  readonly hashesByPath: Map<string, string>;
} => {
  const assets: CatalogAsset[] = [];
  const artifacts: Artifact[] = [];
  const hashesByPath = new Map<string, string>();
  for (const target of [...plan.config.exports].sort((a, b) => compareText(a.name, b.name))) {
    const item = resolved.get(entrySelectorKey(target.entry))!;
    const out = item.targets.find((t) => t.targetName === target.name)!;
    const files: TargetFileWithHash[] = [...out.files];
    if (out.lineageTemplate && (item.productKind === 'model' || item.productKind === 'structure')) {
      files.push({
        path: 'ashfox-lineage.json',
        bytes: patchLineageBytes(
          out.lineageTemplate,
          item.productKind,
          target.name,
          plan.buildKey,
          modelWorkspaceHash,
        ),
      });
    }
    const records = files
      .map((file) => {
        if (!safeRelative(file.path)) throw new BuildFailure('export.path', file.path);
        const relative = `assets/${target.name}/${file.path}`;
        const sha256 = file.sha256 ?? digest(file.bytes);
        artifacts.push({ path: relative, bytes: file.bytes });
        hashesByPath.set(relative, sha256);
        return { path: relative, sha256, byteLength: file.bytes.length };
      })
      .sort((a, b) => compareText(a.path, b.path));
    assets.push({
      id: target.name,
      kind: item.productKind,
      directory: target.directory,
      files: records,
      metadata:
        out.performance && (item.productKind === 'model' || item.productKind === 'structure')
          ? { ...item.metadata, performance: out.performance }
          : item.metadata,
    });
  }
  return { assets, artifacts, hashesByPath };
};

const buildPackAssetMetadata = (
  pack: NonNullable<Snapshot['config']['packs']>[number],
): AssetMetadata =>
  pack.format === 'minecraft_java'
    ? {
        minecraftVersion: pack.minecraftVersion,
        resourceRoot: 'resource-pack',
        archive: pack.archive ? `${pack.name}.zip` : null,
      }
    : {
        resourceRoot: 'game-assets',
        manifest: 'assets.json',
        archive: pack.archive ? `${pack.name}.zip` : null,
      };

const assertBindingNoLoop = (
  format: string,
  sourceName: string,
  config: Snapshot['config'],
  entriesByKey: ReadonlyMap<string, ResolvedBuildEntry>,
): void => {
  const target = config.exports.find((e) => e.name === sourceName);
  const resolved = target ? entriesByKey.get(entrySelectorKey(target.entry)) : undefined;
  if (!resolved?.sounds?.some((s) => s.playback.kind === 'loop')) return;
  throw new BuildFailure(
    format === 'minecraft_java' ? 'sound.loop.target' : 'sound.loop.codec',
    `${sourceName}: loop audio requires WAV game delivery`,
  );
};

export const assertNoLoopPackBindings = (
  config: Snapshot['config'],
  entriesByKey: ReadonlyMap<string, ResolvedBuildEntry>,
): void => {
  for (const pack of config.packs ?? []) {
    const bindings =
      pack.format === 'minecraft_java' ? pack.sounds : pack.audio === 'ogg' ? pack.assets : [];
    for (const binding of bindings) {
      assertBindingNoLoop(pack.format, binding.source, config, entriesByKey);
    }
  }
};

export const finalizeNodeBundle = async (
  snapshot: Snapshot,
  plan: WorkspaceExecutionPlan,
  resolved: ReadonlyMap<string, ResolvedBuildEntry>,
  modelWorkspaceHash: string,
  toolchain: string,
  cache: DiskCacheContext,
  signal?: AbortSignal,
): Promise<CompiledBundle> => {
  const { assets, artifacts, hashesByPath } = assembleCatalogAndArtifacts(
    plan,
    resolved,
    modelWorkspaceHash,
  );
  const getEncoder = createLazyVorbisGetter(signal);
  for (const pack of [...(plan.config.packs ?? [])].sort((a, b) => compareText(a.name, b.name))) {
    const packFiles = await compileNodePackWithCache(pack, assets, artifacts, cache, getEncoder);
    const records = packFiles
      .map((file) => {
        const relative = `assets/${pack.name}/${file.path}`;
        const sha256 = file.sha256 ?? digest(file.bytes);
        artifacts.push({ path: relative, bytes: file.bytes });
        hashesByPath.set(relative, sha256);
        return { path: relative, sha256, byteLength: file.bytes.length };
      })
      .sort((a, b) => compareText(a.path, b.path));
    assets.push({
      id: pack.name,
      kind: 'pack',
      directory: pack.directory,
      files: records,
      metadata: buildPackAssetMetadata(pack),
    });
  }
  const effectiveToolchain = requiresVorbisEncoder(snapshot)
    ? json({ compiler: toolchain, vorbis: VORBIS_FINGERPRINT })
    : toolchain;
  const catalog = { format: 'ashfox-catalog' as const, version: 1 as const, assets };
  const catalogBytes = encodeUtf8(json(catalog));
  artifacts.push({ path: 'catalog.json', bytes: catalogBytes });
  hashesByPath.set('catalog.json', digest(catalogBytes));
  artifacts.sort((a, b) => compareText(a.path, b.path));
  if (new Set(artifacts.map((file) => file.path.toLowerCase())).size !== artifacts.length) {
    throw new BuildFailure('export.collision', 'Duplicate output path');
  }
  const receipt = {
    format: 'ashfox-build-receipt' as const,
    version: 1 as const,
    sourceHash: plan.sourceHash,
    requestKey: digest(json({ buildKey: plan.buildKey, toolchain: effectiveToolchain })),
    toolchain: effectiveToolchain,
    catalogHash: hashesByPath.get('catalog.json')!,
    files: artifacts.map((file) => ({
      path: file.path,
      sha256: hashesByPath.get(file.path)!,
      byteLength: file.bytes.length,
    })),
  };
  return { receipt, catalog, artifacts, bundleHash: digest('ashfox-bundle:1\n' + json(receipt)) };
};
