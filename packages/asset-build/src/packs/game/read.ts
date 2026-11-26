import { readPlayback } from '../../bundle/audio';
import { BuildFailure } from '../../bundle/contract';
import type { GameAssetManifest } from './contract';
import { safeRelative } from '../../shared/path';
import { isClosedContractRecord } from '@ashfox/internal-contracts';
const fail = (message: string): never => {
  throw new BuildFailure('output.integrity', 'Game manifest: ' + message, 3);
};

const record = (v: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> => {
  if (!isClosedContractRecord(v)) return fail('Expected record');
  if (Object.keys(v).length !== keys.length || keys.some((k) => !Object.hasOwnProperty.call(v, k)))
    fail('Unexpected fields');
  return v;
};

const finite = (v: unknown, positive: boolean): boolean =>
  typeof v === 'number' && Number.isFinite(v) && (positive ? v > 0 : v >= 0);

const readAssetFilePaths = (rawFiles: unknown, allPaths: Set<string>): Set<string> => {
  if (!Array.isArray(rawFiles) || !rawFiles.length || rawFiles.length > 8192)
    return fail('Invalid files');
  const paths = new Set<string>();
  for (const rawFile of rawFiles) {
    const f = record(rawFile, ['path', 'sha256', 'byteLength']);
    if (
      typeof f.path !== 'string' ||
      !safeRelative(f.path) ||
      f.path === 'assets.json' ||
      allPaths.has(f.path.toLowerCase()) ||
      typeof f.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(f.sha256) ||
      !Number.isSafeInteger(f.byteLength) ||
      (f.byteLength as number) < 0
    )
      return fail('Invalid file record');
    paths.add(f.path);
    allPaths.add(f.path.toLowerCase());
  }
  return paths;
};

const validateModelAsset = (
  a: Record<string, unknown>,
  reference: (path: unknown, extension: string) => void,
): void => {
  reference(a.model, '.glb');
  if (a.coordinateSystem !== 'gltf2' || !finite(a.unitsPerMeter, true) || !Array.isArray(a.clips))
    fail('Invalid model metadata');
  if (
    !Array.isArray(a.requiredExtensions) ||
    a.requiredExtensions.some((e) => typeof e !== 'string' || !e)
  )
    fail('Invalid glTF extensions');
  for (const rawClip of a.clips as unknown[]) {
    const clip = record(rawClip, ['name', 'durationSeconds']);
    if (typeof clip.name !== 'string' || !clip.name || !finite(clip.durationSeconds, false))
      fail('Invalid animation clip');
  }
};

const validateSoundAsset = (
  a: Record<string, unknown>,
  reference: (path: unknown, extension: string) => void,
): void => {
  if (!['wav', 'ogg'].includes(String(a.codec)) || !Array.isArray(a.variants) || !a.variants.length)
    fail('Invalid audio metadata');
  const variants = new Set<string>();
  for (const rawVariant of a.variants as unknown[]) {
    const v = record(rawVariant, [
      'id',
      'file',
      'durationSeconds',
      'sampleRate',
      'channels',
      'frames',
      'playback',
    ]);
    if (
      typeof v.id !== 'string' ||
      !v.id ||
      variants.has(v.id) ||
      !finite(v.durationSeconds, true) ||
      !Number.isSafeInteger(v.frames) ||
      (v.frames as number) < 2400 ||
      (v.frames as number) > 1440000 ||
      v.durationSeconds !== (v.frames as number) / 48000 ||
      v.sampleRate !== 48000 ||
      (v.channels !== 1 && v.channels !== 2)
    )
      return fail('Invalid sound variant');
    const playback = readPlayback(v.playback, v.frames as number);
    if (a.codec === 'ogg' && playback.kind === 'loop') fail('Loop delivery requires WAV');
    if (a.codec === 'wav') {
      const file = (a.files as Record<string, unknown>[]).find((f) => f.path === v.file);
      if (file?.byteLength !== 44 + (v.frames as number) * 2 * (v.channels as number))
        fail('WAV frame count mismatch');
    }
    variants.add(v.id);
    reference(v.file, '.' + a.codec);
  }
};

const fieldsForAssetKind = (kind: unknown): readonly string[] => {
  if (kind === 'model')
    return ['model', 'coordinateSystem', 'unitsPerMeter', 'clips', 'requiredExtensions'];
  if (kind === 'sprite') return ['image', 'width', 'height', 'pixelsPerUnit', 'filter'];
  if (kind === 'sound') return ['codec', 'variants'];
  return fail('Unknown kind');
};

const validateSpriteAsset = (
  a: Record<string, unknown>,
  reference: (path: unknown, extension: string) => void,
): void => {
  reference(a.image, '.png');
  if (
    !Number.isSafeInteger(a.width) ||
    !finite(a.width, true) ||
    !Number.isSafeInteger(a.height) ||
    !finite(a.height, true) ||
    !finite(a.pixelsPerUnit, true) ||
    !['nearest', 'linear'].includes(String(a.filter))
  )
    fail('Invalid sprite metadata');
};

const validateManifestAsset = (raw: unknown, ids: Set<string>, allPaths: Set<string>): void => {
  if (!isClosedContractRecord(raw) || !('kind' in raw)) return fail('Invalid kind');
  const a = record(raw, ['id', 'kind', 'files', ...fieldsForAssetKind(raw.kind)]);
  if (typeof a.id !== 'string' || !/^[a-z][a-z0-9_.:/-]{0,127}$/.test(a.id) || ids.has(a.id))
    return fail('Invalid or duplicate ID');
  ids.add(a.id);
  const paths = readAssetFilePaths(a.files, allPaths);
  const referenced: string[] = [];
  const reference = (filePath: unknown, extension: string): void => {
    if (typeof filePath !== 'string' || !paths.has(filePath) || !filePath.endsWith(extension))
      return fail('Missing typed file reference');
    referenced.push(filePath);
  };
  if (a.kind === 'model') validateModelAsset(a, reference);
  else if (a.kind === 'sprite') validateSpriteAsset(a, reference);
  else validateSoundAsset(a, reference);
  if (referenced.length !== paths.size || new Set(referenced).size !== paths.size)
    fail('Incomplete file references');
};

/** Validate the generated runtime contract before consuming file references. */
export const readGameAssetManifest = (value: unknown): GameAssetManifest => {
  const r = record(value, ['format', 'version', 'assets']);
  if (
    r.format !== 'ashfox-game-assets' ||
    r.version !== 1 ||
    !Array.isArray(r.assets) ||
    !r.assets.length
  )
    return fail('Invalid format or assets');
  const ids = new Set<string>(),
    allPaths = new Set<string>();
  for (const raw of r.assets) validateManifestAsset(raw, ids, allPaths);
  return value as GameAssetManifest;
};
