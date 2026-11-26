import { readPlayback, verifyPcm, pcmStatistics } from '../bundle/audio';
import { readClosedRecord, readGameAssetManifest } from '../packs/game/read';
import { compareText, decodeUtf8, isClosedContractRecord } from '@ashfox/internal-contracts';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  BuildFailure,
  type Receipt,
  type Catalog,
  type FileRecord,
  type CatalogAsset,
  type AssetMetadata,
} from '../bundle/contract';
import { digest, json } from '../shared/digest';
import { contained, listFiles, noLinks, safeRelative } from './paths';
const fail = (message: string): never => {
  throw new BuildFailure('output.integrity', message, 3);
};
const record = (value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> =>
  readClosedRecord(value, keys, fail);
const isHash = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
const shouldCacheBytes = (file: string): boolean =>
  file.endsWith('.wav') || path.basename(file) === 'assets.json';
const readCachedBytes = (file: string, cache: Map<string, Buffer>): Buffer => {
  if (!shouldCacheBytes(file)) return fs.readFileSync(file);
  const cached = cache.get(file);
  if (cached) return cached;
  const bytes = fs.readFileSync(file);
  cache.set(file, bytes);
  return bytes;
};
const isSortedText = (values: readonly string[]): boolean => {
  for (let i = 1; i < values.length; i++) {
    if (compareText(values[i - 1]!, values[i]!) > 0) return false;
  }
  return true;
};
const sameTextList = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);
const sameFileRecords = (left: readonly FileRecord[], right: readonly FileRecord[]): boolean =>
  left.length === right.length &&
  left.every(
    (file, index) =>
      file.path === right[index]!.path &&
      file.sha256 === right[index]!.sha256 &&
      file.byteLength === right[index]!.byteLength,
  );
const readJson = (file: string, cache?: Map<string, Buffer>): unknown => {
  noLinks(file);
  if (fs.statSync(file).size > 4 * 1024 * 1024) return fail('Oversized metadata');
  const text = cache ? decodeUtf8(readCachedBytes(file, cache)) : fs.readFileSync(file, 'utf8'),
    value: unknown = JSON.parse(text);
  if (text !== json(value)) fail('Metadata must be canonical JSON');
  return value;
};
const isArchiveField = (archive: unknown): archive is string | null =>
  archive === null ||
  (typeof archive === 'string' && safeRelative(archive) && archive.endsWith('.zip'));

const verifyPackMetadata = (value: unknown): AssetMetadata => {
  if (isClosedContractRecord(value) && value.resourceRoot === 'game-assets') {
    const r = record(value, ['resourceRoot', 'manifest', 'archive']);
    if (r.manifest !== 'assets.json' || !isArchiveField(r.archive))
      fail('Invalid game pack metadata');
    return {
      resourceRoot: 'game-assets',
      manifest: 'assets.json',
      archive: r.archive as string | null,
    };
  }
  const r = record(value, ['minecraftVersion', 'resourceRoot', 'archive']);
  if (
    typeof r.minecraftVersion !== 'string' ||
    !r.minecraftVersion ||
    r.resourceRoot !== 'resource-pack' ||
    !isArchiveField(r.archive)
  )
    fail('Invalid pack metadata');
  return {
    minecraftVersion: r.minecraftVersion as string,
    resourceRoot: 'resource-pack',
    archive: r.archive as string | null,
  };
};

const verifyModelMetadata = (value: unknown): AssetMetadata => {
  const r = record(value, ['clips']);
  if (!Array.isArray(r.clips)) return fail('Invalid clips');
  return {
    clips: r.clips.map((raw) => {
      const clip = record(raw, ['name', 'durationSeconds']);
      if (
        typeof clip.name !== 'string' ||
        typeof clip.durationSeconds !== 'number' ||
        !Number.isFinite(clip.durationSeconds) ||
        clip.durationSeconds < 0
      )
        fail('Invalid clip');
      return { name: clip.name as string, durationSeconds: clip.durationSeconds as number };
    }),
  };
};

const verifyAudioVariantMetadata = (raw: unknown) => {
  const variant = record(raw, [
    'id',
    'frames',
    'sampleRate',
    'channels',
    'playback',
    'peak',
    'rms',
    'dc',
    'seamDelta',
    'maxAdjacentDelta',
  ]);
  if (
    typeof variant.id !== 'string' ||
    !Number.isSafeInteger(variant.frames) ||
    (variant.frames as number) <= 0 ||
    variant.sampleRate !== 48000 ||
    (variant.channels !== 1 && variant.channels !== 2)
  )
    fail('Invalid audio metadata');
  for (const key of ['peak', 'rms', 'dc', 'seamDelta', 'maxAdjacentDelta']) {
    if (typeof variant[key] !== 'number' || !Number.isFinite(variant[key]))
      fail('Invalid audio statistics');
  }
  return {
    id: variant.id as string,
    frames: variant.frames as number,
    sampleRate: 48000 as const,
    channels: variant.channels as 1 | 2,
    peak: variant.peak as number,
    rms: variant.rms as number,
    dc: variant.dc as number,
    seamDelta: variant.seamDelta as number,
    maxAdjacentDelta: variant.maxAdjacentDelta as number,
    playback: readPlayback(variant.playback, variant.frames as number),
  };
};

const verifyStructureMetadata = (value: unknown): AssetMetadata => {
  const r = record(value, ['size', 'blockCount', 'interiorCells']);
  if (
    !Array.isArray(r.size) ||
    r.size.length !== 3 ||
    r.size.some((n) => !Number.isSafeInteger(n) || (n as number) < 1) ||
    !Number.isSafeInteger(r.blockCount) ||
    !Number.isSafeInteger(r.interiorCells)
  ) {
    fail('Invalid structure metadata');
  }
  const s = r.size as [number, number, number];
  return {
    size: [s[0], s[1], s[2]],
    blockCount: r.blockCount as number,
    interiorCells: r.interiorCells as number,
  };
};

const metadata = (kind: unknown, value: unknown): AssetMetadata => {
  if (kind === 'pack') return verifyPackMetadata(value);
  if (kind === 'sprite') {
    const r = record(value, ['width', 'height']);
    if (![16, 32, 64].includes(r.width as number) || r.width !== r.height)
      fail('Invalid sprite dimensions');
    return { width: r.width as number, height: r.height as number };
  }
  if (kind === 'model') return verifyModelMetadata(value);
  if (kind === 'structure') return verifyStructureMetadata(value);
  const r = record(value, ['variants']);
  if (!Array.isArray(r.variants)) return fail('Invalid variants');
  return { variants: r.variants.map(verifyAudioVariantMetadata) };
};

const verifyReceiptFiles = (
  directory: string,
  rawFiles: unknown[],
  cache: Map<string, Buffer>,
): { names: string[]; fileRecords: FileRecord[] } => {
  const names: string[] = [],
    fileRecords: FileRecord[] = [],
    seenLower = new Set<string>();
  for (const raw of rawFiles) {
    const file = record(raw, ['path', 'sha256', 'byteLength']);
    if (
      typeof file.path !== 'string' ||
      !safeRelative(file.path) ||
      !isHash(file.sha256) ||
      !Number.isSafeInteger(file.byteLength) ||
      (file.byteLength as number) < 0 ||
      (file.byteLength as number) > 128 * 1024 * 1024
    )
      fail('Invalid file record');
    const relative = file.path as string;
    if (relative === 'receipt.json') fail('Self-referential receipt');
    const target = contained(directory, relative);
    noLinks(target);
    if (
      fs.statSync(target).size !== file.byteLength ||
      digest(readCachedBytes(target, cache)) !== file.sha256
    )
      fail('Artifact mismatch: ' + relative);
    names.push(relative);
    seenLower.add(relative.toLowerCase());
    fileRecords.push({
      path: relative,
      sha256: file.sha256 as string,
      byteLength: file.byteLength as number,
    });
  }
  if (seenLower.size !== names.length || !isSortedText(names)) fail('Duplicate or unordered files');
  if (!sameTextList(listFiles(directory), [...names, 'receipt.json'].sort(compareText)))
    fail('Missing or additional files');
  return { names, fileRecords };
};

const verifySoundCoverage = (
  directory: string,
  details: Extract<AssetMetadata, { readonly variants: readonly unknown[] }>,
  assetFiles: readonly FileRecord[],
  cache: Map<string, Buffer>,
): void => {
  const variants = new Set(details.variants.map((v) => v.id));
  if (
    variants.size !== details.variants.length ||
    !variants.size ||
    variants.size > 8 ||
    assetFiles.length !== variants.size
  )
    fail('Invalid sound file coverage');
  const wavByVariant = new Map<string, FileRecord>();
  for (const file of assetFiles) {
    const slash = file.path.lastIndexOf('/');
    if (slash >= 0 && file.path.endsWith('.wav'))
      wavByVariant.set(file.path.slice(slash + 1, -4), file);
  }
  for (const variant of details.variants) {
    const file = wavByVariant.get(variant.id);
    if (!file) return fail('Missing sound WAV');
    const pcm = readCachedBytes(contained(directory, file.path), cache);
    verifyPcm(pcm, variant.frames, variant.channels);
    const stats = pcmStatistics(pcm, variant.frames, variant.channels);
    for (const key of ['peak', 'rms', 'dc', 'seamDelta', 'maxAdjacentDelta'] as const) {
      if (stats[key] !== variant[key]) fail('Audio statistics do not match PCM');
    }
  }
};

const verifyGameManifestAssets = (
  directory: string,
  root: string,
  manifestFile: string,
  assetFiles: readonly FileRecord[],
  cache: Map<string, Buffer>,
): void => {
  const manifest = readGameAssetManifest(
    readJson(contained(directory, root + manifestFile), cache),
  );
  const references = manifest.assets
    .flatMap((a) => a.files)
    .map((f) => ({ ...f, path: root + f.path }))
    .sort((a, b) => compareText(a.path, b.path));
  const actual = assetFiles
    .filter((f) => f.path.startsWith(root) && f.path !== root + manifestFile)
    .sort((a, b) => compareText(a.path, b.path));
  if (!sameFileRecords(references, actual)) fail('Game manifest lineage mismatch');
  for (const sound of manifest.assets) {
    if (sound.kind !== 'sound' || sound.codec !== 'wav') continue;
    for (const variant of sound.variants) {
      const ch = variant.channels === 2 ? 2 : 1;
      verifyPcm(
        readCachedBytes(contained(directory, root + variant.file), cache),
        variant.frames,
        ch,
      );
    }
  }
};

const verifyPackCoverage = (
  directory: string,
  assetId: string,
  details: Extract<AssetMetadata, { readonly resourceRoot: string }>,
  assetFiles: readonly FileRecord[],
  cache: Map<string, Buffer>,
): void => {
  const prefix = `assets/${assetId}/`;
  const root = prefix + details.resourceRoot + '/';
  const entry = details.resourceRoot === 'resource-pack' ? 'pack.mcmeta' : details.manifest;
  if (
    !assetFiles.some((f) => f.path === root + entry) ||
    (details.archive !== null && !assetFiles.some((f) => f.path === prefix + details.archive)) ||
    assetFiles.some((f) => !f.path.startsWith(root) && f.path !== prefix + details.archive)
  )
    fail('Invalid pack file coverage');
  if (details.resourceRoot === 'game-assets')
    verifyGameManifestAssets(directory, root, details.manifest, assetFiles, cache);
};

const verifyCatalogAsset = (
  directory: string,
  rawAsset: unknown,
  fileByPath: ReadonlyMap<string, FileRecord>,
  ids: Set<string>,
  referenced: string[],
  cache: Map<string, Buffer>,
): CatalogAsset => {
  const asset = record(rawAsset, ['id', 'kind', 'directory', 'files', 'metadata']);
  if (
    typeof asset.id !== 'string' ||
    !/^[a-z][a-z0-9_]{0,47}$/u.test(asset.id) ||
    ids.has(asset.id) ||
    !['model', 'sprite', 'sound', 'structure', 'pack'].includes(String(asset.kind)) ||
    typeof asset.directory !== 'string' ||
    !safeRelative(asset.directory) ||
    !Array.isArray(asset.files)
  )
    fail('Invalid asset');
  ids.add(asset.id as string);
  const assetFiles: FileRecord[] = [];
  for (const rawFile of asset.files as unknown[]) {
    const file = record(rawFile, ['path', 'sha256', 'byteLength']);
    const match = typeof file.path === 'string' ? fileByPath.get(file.path) : undefined;
    if (
      !match ||
      !match.path.startsWith(`assets/${asset.id}/`) ||
      file.sha256 !== match.sha256 ||
      file.byteLength !== match.byteLength
    )
      return fail('Catalog lineage mismatch');
    referenced.push(match.path);
    assetFiles.push(match);
  }
  const details = metadata(asset.kind, asset.metadata);
  if (asset.kind === 'sound' && 'variants' in details)
    verifySoundCoverage(directory, details, assetFiles, cache);
  if (asset.kind === 'pack' && 'resourceRoot' in details)
    verifyPackCoverage(directory, asset.id as string, details, assetFiles, cache);
  return {
    id: asset.id as string,
    kind: asset.kind as CatalogAsset['kind'],
    directory: asset.directory as string,
    files: assetFiles,
    metadata: details,
  };
};

const readValidatedReceipt = (
  directory: string,
  hash: string,
): Readonly<Record<string, unknown>> => {
  const r = record(readJson(path.join(directory, 'receipt.json')), [
    'format',
    'version',
    'sourceHash',
    'requestKey',
    'toolchain',
    'catalogHash',
    'files',
  ]);
  if (
    r.format !== 'ashfox-build-receipt' ||
    r.version !== 1 ||
    typeof r.sourceHash !== 'string' ||
    !isHash(r.requestKey) ||
    !isHash(r.catalogHash) ||
    typeof r.toolchain !== 'string' ||
    !Array.isArray(r.files)
  )
    fail('Invalid receipt');
  if (digest('ashfox-bundle:1\n' + json(r)) !== hash) fail('Receipt hash mismatch');
  return r;
};

export const verifyBundle = (
  directory: string,
  hash: string,
): { receipt: Receipt; catalog: Catalog } => {
  noLinks(directory);
  if (!isHash(hash)) return fail('Invalid bundle hash');
  const r = readValidatedReceipt(directory, hash);
  const fileCache = new Map<string, Buffer>();
  const { names, fileRecords } = verifyReceiptFiles(directory, r.files as unknown[], fileCache);
  const fileByPath = new Map(fileRecords.map((file) => [file.path, file]));
  const c = record(readJson(contained(directory, 'catalog.json'), fileCache), [
    'format',
    'version',
    'assets',
  ]);
  if (
    c.format !== 'ashfox-catalog' ||
    c.version !== 1 ||
    !Array.isArray(c.assets) ||
    digest(json(c)) !== r.catalogHash
  )
    fail('Invalid catalog');
  const ids = new Set<string>(),
    referenced: string[] = [];
  const assets = (c.assets as unknown[]).map((raw) =>
    verifyCatalogAsset(directory, raw, fileByPath, ids, referenced, fileCache),
  );
  if (
    !sameTextList(
      referenced.sort(compareText),
      names.filter((n) => n !== 'catalog.json'),
    )
  )
    fail('Catalog coverage mismatch');
  return {
    receipt: {
      format: 'ashfox-build-receipt',
      version: 1,
      sourceHash: r.sourceHash as string,
      requestKey: r.requestKey as string,
      toolchain: r.toolchain as string,
      catalogHash: r.catalogHash as string,
      files: fileRecords,
    },
    catalog: { format: 'ashfox-catalog', version: 1, assets },
  };
};
export const verifyCurrent = (output: string) => {
  output = path.join(fs.realpathSync(path.dirname(path.resolve(output))), path.basename(output));
  noLinks(output);
  const current = record(readJson(path.join(output, 'current.json')), [
    'format',
    'version',
    'bundleHash',
  ]);
  if (current.format !== 'ashfox-current' || current.version !== 1 || !isHash(current.bundleHash))
    return fail('Invalid pointer');
  const hash = current.bundleHash as string,
    directory = path.join(output, 'bundles', hash);
  return { bundleHash: hash, bundlePath: directory, ...verifyBundle(directory, hash) };
};
