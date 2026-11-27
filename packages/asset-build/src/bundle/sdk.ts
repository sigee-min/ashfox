import {
  SDK_TARGETS,
  generateRuntimeSdk,
  type GeneratedSdkFile,
  type SdkManifestAsset,
  type SdkManifestInput,
  type SdkTarget,
} from '@ashfox/engine-core';
import { compareText, decodeUtf8 } from '@ashfox/internal-contracts';
import type { Artifact, Catalog, CatalogAsset } from './contract';

export const normalizeSdkTargets = (targets: readonly SdkTarget[]): readonly SdkTarget[] => {
  const chosen = new Set(targets);
  return SDK_TARGETS.filter((target) => chosen.has(target));
};

const readHooksColliders = (
  hooksPath: string | undefined,
  artifactMap: ReadonlyMap<string, Uint8Array>,
): unknown => {
  if (!hooksPath) return undefined;
  const bytes = artifactMap.get(hooksPath);
  if (!bytes) return undefined;
  try {
    const parsed = JSON.parse(decodeUtf8(bytes)) as { colliders?: unknown };
    return parsed.colliders;
  } catch {
    return undefined;
  }
};

const toSoundSdkAsset = (asset: CatalogAsset, hooksPath: string | undefined): SdkManifestAsset => {
  const variantsMeta = 'variants' in asset.metadata ? asset.metadata.variants : [];
  const variants = variantsMeta.map((variant) => {
    const file = asset.files.find((f) => f.path.endsWith(`/${variant.id}.wav`))?.path ?? '';
    return {
      id: variant.id,
      file,
      durationSeconds: variant.frames / variant.sample_rate,
      sampleRate: variant.sample_rate,
      channels: variant.channels,
      playback: variant.playback,
      ...(variant.playback.kind === 'loop'
        ? {
            loopStartSample: variant.playback.startFrame,
            loopEndSample: variant.playback.endFrame,
          }
        : {}),
    };
  });
  return {
    id: asset.id,
    kind: 'sound',
    codec: 'wav',
    variants,
    ...(hooksPath ? { hooks: hooksPath } : {}),
  };
};

const toCatalogSdkAsset = (
  asset: CatalogAsset,
  artifactMap: ReadonlyMap<string, Uint8Array>,
): SdkManifestAsset | null => {
  if (asset.kind === 'pack') return null;
  const paths = asset.files.map((f) => f.path);
  const glbPath = paths.find((p) => p.endsWith('.glb'));
  const pngPath = paths.find((p) => p.endsWith('.png'));
  const hooksPath = paths.find((p) => p.endsWith('.hooks.json'));
  const vfxPath = paths.find((p) => p.endsWith('.vfx.json'));
  const structPath = paths.find((p) => p.endsWith('.structure.json'));
  if (asset.kind === 'sound') return toSoundSdkAsset(asset, hooksPath);
  if (asset.kind === 'sprite') {
    return { id: asset.id, kind: 'sprite', ...(pngPath ? { image: pngPath } : {}) };
  }
  const colliders = readHooksColliders(hooksPath, artifactMap);
  const clips = 'clips' in asset.metadata ? asset.metadata.clips : undefined;
  return {
    id: asset.id,
    kind: asset.kind,
    ...(glbPath ? { model: glbPath } : {}),
    ...(structPath ? { meta: structPath } : {}),
    ...(vfxPath ? { vfxSpec: vfxPath } : {}),
    ...(hooksPath ? { hooks: hooksPath } : {}),
    ...(clips ? { clips } : {}),
    ...(colliders !== undefined ? { colliders } : {}),
  };
};

export const buildSdkManifest = (
  workspaceName: string,
  catalog: Catalog,
  artifacts: readonly Artifact[],
): SdkManifestInput => {
  const artifactMap = new Map(artifacts.map((a) => [a.path, a.bytes]));
  const assets: SdkManifestAsset[] = [];
  for (const entry of catalog.assets) {
    const converted = toCatalogSdkAsset(entry, artifactMap);
    if (converted) assets.push(converted);
  }
  assets.sort((a, b) => compareText(a.id, b.id));
  return { name: workspaceName, assets };
};

/** Generate deterministic runtime SDK files for the selected engine targets. */
export const generateBundleRuntimeSdk = (
  workspaceName: string,
  catalog: Catalog,
  artifacts: readonly Artifact[],
  targets: readonly SdkTarget[],
): readonly GeneratedSdkFile[] => {
  const orderedTargets = normalizeSdkTargets(targets);
  if (orderedTargets.length === 0) return [];
  const manifest = buildSdkManifest(workspaceName, catalog, artifacts);
  return orderedTargets.flatMap((target) => generateRuntimeSdk(target, manifest));
};
