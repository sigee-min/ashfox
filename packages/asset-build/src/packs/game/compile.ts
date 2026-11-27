import { readGameAssetManifest } from './read';
import type { GameAssetPack, ModelColliderSet } from '@ashfox/engine-core';
import { compareText, decodeUtf8, encodeUtf8 } from '@ashfox/internal-contracts';
import {
  BuildFailure,
  type Artifact,
  type CatalogAsset,
  type PackEncoder,
} from '../../bundle/contract';
import type { GameAssetManifest, GamePackOptions, RuntimeAsset } from './contract';
import { digest, json } from '../../shared/digest';
import { archivePack } from '../archive';
import { deduplicateSharedGlbTextures } from './sharedTextures';
import { indexCatalogAssetFiles, type IndexedCatalogAssetFiles } from '../sourceIndex';
type RuntimeAssetDetail =
  | Omit<Extract<RuntimeAsset, { kind: 'model' }>, 'files'>
  | Omit<Extract<RuntimeAsset, { kind: 'structure' }>, 'files'>
  | Omit<Extract<RuntimeAsset, { kind: 'sprite' }>, 'files'>
  | Omit<Extract<RuntimeAsset, { kind: 'sound' }>, 'files'>;

interface GamePackContext {
  readonly assetMap: ReadonlyMap<string, CatalogAsset>;
  readonly artifactMap: ReadonlyMap<string, Uint8Array>;
  readonly sourceFiles: ReadonlyMap<string, IndexedCatalogAssetFiles>;
}

const createGamePackContext = (
  assets: readonly CatalogAsset[],
  artifacts: readonly Artifact[],
): GamePackContext => ({
  assetMap: new Map(assets.map((asset) => [asset.id, asset])),
  artifactMap: new Map(artifacts.map((artifact) => [artifact.path, artifact.bytes])),
  sourceFiles: new Map(assets.map((asset) => [asset.id, indexCatalogAssetFiles(asset)])),
});

const readArtifactBytes = (
  artifactMap: ReadonlyMap<string, Uint8Array>,
  path: string,
): Uint8Array => {
  const bytes = artifactMap.get(path);
  if (!bytes) throw new BuildFailure('pack.source', path);
  return bytes;
};

const encodeVariantBytes = async (
  data: Uint8Array,
  packAudio: GameAssetPack['audio'],
  filePath: string,
  loopMeta: { readonly startSample: number; readonly lengthSamples: number } | undefined,
  encoded: Map<string, Uint8Array>,
  encoder?: PackEncoder,
): Promise<Uint8Array> => {
  if (packAudio !== 'ogg') return data;
  if (!encoder) throw new BuildFailure('pack.encoder', 'OGG game assets require a Vorbis encoder');
  const cacheKey = loopMeta
    ? `${filePath}:${loopMeta.startSample}:${loopMeta.lengthSamples}`
    : filePath;
  const cached = encoded.get(cacheKey);
  if (cached) return cached;
  const ogg = await encoder.encode(data, loopMeta);
  encoded.set(cacheKey, ogg);
  return ogg;
};

const compileSoundGameAsset = async (
  bindingId: string,
  source: CatalogAsset,
  sourceFiles: IndexedCatalogAssetFiles,
  variantsMeta: Extract<
    CatalogAsset['metadata'],
    { readonly variants: readonly unknown[] }
  >['variants'],
  packAudio: GameAssetPack['audio'],
  artifactMap: ReadonlyMap<string, Uint8Array>,
  encoded: Map<string, Uint8Array>,
  add: (name: string, bytes: Uint8Array) => string,
  encoder?: PackEncoder,
): Promise<RuntimeAssetDetail> => {
  const variants = [];
  for (const variant of variantsMeta) {
    const filePath = sourceFiles.wavPaths.get(variant.id);
    if (!filePath) throw new BuildFailure('pack.source', `${source.id}/${variant.id}`);
    const loopMeta =
      variant.playback.kind === 'loop'
        ? {
            startSample: variant.playback.startFrame,
            lengthSamples: variant.playback.endFrame - variant.playback.startFrame,
          }
        : undefined;
    const data = await encodeVariantBytes(
      readArtifactBytes(artifactMap, filePath),
      packAudio,
      filePath,
      loopMeta,
      encoded,
      encoder,
    );
    variants.push({
      id: variant.id,
      file: add(`${variant.id}.${packAudio}`, data),
      durationSeconds: variant.frames / variant.sample_rate,
      sample_rate: variant.sample_rate,
      sampleRate: variant.sample_rate,
      channels: variant.channels,
      frames: variant.frames,
      playback: variant.playback,
      ...(variant.playback.kind === 'loop'
        ? {
            loopStartSample: variant.playback.startFrame,
            loopEndSample: variant.playback.endFrame,
          }
        : {}),
    });
  }
  return { id: bindingId, kind: 'sound', codec: packAudio, variants };
};

const readGlbRequiredExtensions = (data: Uint8Array): readonly string[] => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const gltf = JSON.parse(decodeUtf8(data.subarray(20, 20 + view.getUint32(12, true)))) as {
    extensionsRequired?: string[];
  };
  return gltf.extensionsRequired ?? [];
};

const readModelColliders = (
  sourceFiles: IndexedCatalogAssetFiles,
  artifactMap: ReadonlyMap<string, Uint8Array>,
): ModelColliderSet | undefined => {
  if (!sourceFiles.hooksPath) return undefined;
  const bytes = artifactMap.get(sourceFiles.hooksPath);
  if (!bytes) return undefined;
  const hooks = JSON.parse(decodeUtf8(bytes)) as { colliders?: ModelColliderSet };
  return hooks.colliders;
};

const compileModelGameAsset = (
  bindingId: string,
  source: CatalogAsset,
  sourceFiles: IndexedCatalogAssetFiles,
  clips: Extract<CatalogAsset['metadata'], { readonly clips: readonly unknown[] }>['clips'],
  unitsPerMeter: number,
  artifactMap: ReadonlyMap<string, Uint8Array>,
  add: (name: string, bytes: Uint8Array) => string,
): RuntimeAssetDetail => {
  const filePath = sourceFiles.glbPath;
  if (!filePath) throw new BuildFailure('pack.source', source.id + ': expected embedded GLB');
  const data = readArtifactBytes(artifactMap, filePath);
  const colliders = readModelColliders(sourceFiles, artifactMap);
  return {
    id: bindingId,
    kind: 'model',
    model: add(`${source.id}.glb`, data),
    requiredExtensions: readGlbRequiredExtensions(data),
    coordinateSystem: 'gltf2',
    unitsPerMeter,
    clips,
    ...(colliders ? { colliders } : {}),
  };
};

const compileStructureGameAsset = (
  bindingId: string,
  source: CatalogAsset,
  sourceFiles: IndexedCatalogAssetFiles,
  meta: Extract<CatalogAsset['metadata'], { readonly blockCount: number }>,
  artifactMap: ReadonlyMap<string, Uint8Array>,
  add: (name: string, bytes: Uint8Array) => string,
): RuntimeAssetDetail => {
  const glbPath = sourceFiles.glbPath;
  if (!glbPath) throw new BuildFailure('pack.source', source.id + ': expected embedded GLB');
  const metaPath = sourceFiles.structureMetaPath;
  if (!metaPath) throw new BuildFailure('pack.source', source.id + ': expected structure metadata');
  const glbBytes = readArtifactBytes(artifactMap, glbPath);
  const metaBytes = readArtifactBytes(artifactMap, metaPath);
  return {
    id: bindingId,
    kind: 'structure',
    model: add(`${source.id}.glb`, glbBytes),
    meta: add(`${source.id}.structure.json`, metaBytes),
    coordinateSystem: 'gltf2',
    unitsPerBlock: 1,
    requiredExtensions: readGlbRequiredExtensions(glbBytes),
    size: meta.size,
    zoneCount: meta.zoneCount ?? 0,
    lightCount: meta.lightCount ?? 0,
    interactableCount: meta.interactableCount ?? 0,
  };
};

const compileSpriteGameAsset = (
  bindingId: string,
  source: CatalogAsset,
  sourceFiles: IndexedCatalogAssetFiles,
  meta: Extract<CatalogAsset['metadata'], { readonly width: number }>,
  pack: GameAssetPack,
  artifactMap: ReadonlyMap<string, Uint8Array>,
  add: (name: string, bytes: Uint8Array) => string,
): RuntimeAssetDetail => {
  const filePath = sourceFiles.pngPath;
  if (!filePath) throw new BuildFailure('pack.source', source.id);
  return {
    id: bindingId,
    kind: 'sprite',
    image: add(`${source.id}.png`, readArtifactBytes(artifactMap, filePath)),
    width: meta.width,
    height: meta.height,
    pixelsPerUnit: pack.pixelsPerUnit,
    filter: pack.spriteFilter,
  };
};

const compileBindingDetail = (
  bindingId: string,
  source: CatalogAsset,
  sourceFiles: IndexedCatalogAssetFiles,
  pack: GameAssetPack,
  artifactMap: ReadonlyMap<string, Uint8Array>,
  encoded: Map<string, Uint8Array>,
  add: (name: string, bytes: Uint8Array) => string,
  encoder?: PackEncoder,
): Promise<RuntimeAssetDetail> | RuntimeAssetDetail => {
  if (source.kind === 'sound' && 'variants' in source.metadata) {
    return compileSoundGameAsset(
      bindingId,
      source,
      sourceFiles,
      source.metadata.variants,
      pack.audio,
      artifactMap,
      encoded,
      add,
      encoder,
    );
  }
  if (source.kind === 'sprite' && 'width' in source.metadata) {
    return compileSpriteGameAsset(
      bindingId,
      source,
      sourceFiles,
      source.metadata,
      pack,
      artifactMap,
      add,
    );
  }
  if (source.kind === 'model' && 'clips' in source.metadata) {
    return compileModelGameAsset(
      bindingId,
      source,
      sourceFiles,
      source.metadata.clips,
      pack.unitsPerMeter,
      artifactMap,
      add,
    );
  }
  if (source.kind === 'structure' && 'blockCount' in source.metadata) {
    return compileStructureGameAsset(
      bindingId,
      source,
      sourceFiles,
      source.metadata,
      artifactMap,
      add,
    );
  }
  throw new BuildFailure('pack.source', source.id + ': unsupported metadata');
};

const finalizeGamePack = (
  pack: GameAssetPack,
  pending: ReadonlyArray<{
    readonly detail: RuntimeAssetDetail;
    readonly paths: readonly string[];
  }>,
  files: readonly Artifact[],
  deduplicate: boolean,
): readonly Artifact[] => {
  const deduped = deduplicateSharedGlbTextures(files, deduplicate);
  const fileByPath = new Map(deduped.files.map((f) => [f.path, f]));
  const runtime: RuntimeAsset[] = pending.map(({ detail, paths }) => ({
    ...detail,
    files: paths.map((p) => {
      const f = fileByPath.get(p)!;
      return { path: f.path, sha256: digest(f.bytes), byteLength: f.bytes.length };
    }),
  }));
  const sharedRecords = deduped.sharedTextures.map((f) => ({
    path: f.path,
    sha256: digest(f.bytes),
    byteLength: f.bytes.length,
  }));
  const manifest: GameAssetManifest = {
    format: 'ashfox-game-assets',
    version: 1,
    ...(sharedRecords.length > 0 ? { sharedTextures: sharedRecords } : {}),
    assets: runtime,
  };
  readGameAssetManifest(manifest);
  const outputFiles: Artifact[] = [
    ...deduped.files,
    ...deduped.sharedTextures,
    { path: 'assets.json', bytes: encodeUtf8(json(manifest)) },
  ];
  return archivePack(pack.name, 'game-assets', pack.archive, outputFiles);
};

export const compileGamePack = async (
  pack: GameAssetPack,
  assets: readonly CatalogAsset[],
  artifacts: readonly Artifact[],
  encoder?: PackEncoder,
  options: GamePackOptions = {},
): Promise<readonly Artifact[]> => {
  const files: Artifact[] = [],
    pending: Array<{ readonly detail: RuntimeAssetDetail; readonly paths: readonly string[] }> = [],
    encoded = new Map<string, Uint8Array>(),
    context = createGamePackContext(assets, artifacts);
  for (const binding of [...pack.assets].sort((a, b) => compareText(a.id, b.id))) {
    const source = context.assetMap.get(binding.source);
    const sourceFiles = context.sourceFiles.get(binding.source);
    if (!source || !sourceFiles || source.kind === 'pack')
      throw new BuildFailure('pack.source', binding.source);
    const paths: string[] = [];
    const add = (name: string, bytes: Uint8Array): string => {
      const path = `${binding.path}/${name}`;
      files.push({ path, bytes });
      paths.push(path);
      return path;
    };
    const detail = await compileBindingDetail(
      binding.id,
      source,
      sourceFiles,
      pack,
      context.artifactMap,
      encoded,
      add,
      encoder,
    );
    pending.push({ detail, paths });
  }
  return finalizeGamePack(pack, pending, files, options.deduplicateTextures ?? true);
};
