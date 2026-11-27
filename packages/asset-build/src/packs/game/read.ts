import { readPlayback } from '../../bundle/audio';
import { BuildFailure } from '../../bundle/contract';
import type { GameAssetManifest } from './contract';
import { safeRelative } from '../../shared/path';
import { hasExactContractKeys, isClosedContractRecord } from '@ashfox/internal-contracts';

export const readClosedRecord = (
  value: unknown,
  keys: readonly string[],
  onFail: (message: string) => never,
): Readonly<Record<string, unknown>> => {
  if (!isClosedContractRecord(value)) return onFail('Expected record');
  if (!hasExactContractKeys(value, new Set(keys))) onFail('Unexpected fields');
  return value;
};

const fail = (message: string): never => {
  throw new BuildFailure('output.integrity', 'Game manifest: ' + message, 3);
};

const record = (v: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> =>
  readClosedRecord(v, keys, fail);

const finite = (v: unknown, positive: boolean): boolean =>
  typeof v === 'number' && Number.isFinite(v) && (positive ? v > 0 : v >= 0);

const readAssetFilePaths = (rawFiles: unknown, allPaths: Set<string>): Map<string, number> => {
  if (!Array.isArray(rawFiles) || !rawFiles.length || rawFiles.length > 8192)
    return fail('Invalid files');
  const paths = new Map<string, number>();
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
    paths.set(f.path, f.byteLength as number);
    allPaths.add(f.path.toLowerCase());
  }
  return paths;
};

const validateRequiredExtensions = (value: unknown): void => {
  if (!Array.isArray(value) || value.some((e) => typeof e !== 'string' || !e))
    fail('Invalid glTF extensions');
};

const isNonNegativeInt = (v: unknown): boolean =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

const validateVec3Tuple = (v: unknown): void => {
  if (
    !Array.isArray(v) ||
    v.length !== 3 ||
    v.some((n) => typeof n !== 'number' || !Number.isFinite(n))
  ) {
    fail('Invalid collider vector');
  }
};

const collectOptionalKeys = (
  item: Record<string, unknown>,
  base: readonly string[],
  optional: readonly string[],
): string[] => {
  const keys = [...base];
  for (const opt of optional) {
    if (opt in item) keys.push(opt);
  }
  return keys;
};

const validateHitZoneShapeFields = (hz: Readonly<Record<string, unknown>>): void => {
  for (const field of ['size', 'min', 'max']) {
    if (field in hz) validateVec3Tuple(hz[field]);
  }
  for (const scalar of ['radius', 'height']) {
    if (scalar in hz && !finite(hz[scalar], true)) fail(`Invalid hitzone ${scalar}`);
  }
};

const validateHitZone = (item: unknown): void => {
  if (!isClosedContractRecord(item)) return fail('Invalid hitzone item');
  const keys = collectOptionalKeys(
    item,
    ['id', 'bone', 'shape', 'multiplier', 'tag', 'center', 'localCenter'],
    ['size', 'min', 'max', 'radius', 'height'],
  );
  const hz = record(item, keys);
  if (typeof hz.id !== 'string' || !hz.id || typeof hz.bone !== 'string' || !hz.bone)
    fail('Invalid hitzone identifiers');
  if (!['box', 'capsule', 'sphere'].includes(String(hz.shape)) || !finite(hz.multiplier, true))
    fail('Invalid hitzone shape or multiplier');
  if (typeof hz.tag !== 'string' || !hz.tag) fail('Invalid hitzone tag');
  validateVec3Tuple(hz.center);
  validateVec3Tuple(hz.localCenter);
  validateHitZoneShapeFields(hz);
};

const validateColliderItem = (item: unknown): void => {
  if (!isClosedContractRecord(item) || !('shape' in item)) fail('Invalid collider item');
  const shape = (item as { readonly shape: unknown }).shape;
  if (shape === 'capsule') {
    const c = record(item, ['shape', 'axis', 'center', 'radius', 'height']);
    validateVec3Tuple(c.center);
    if (c.axis !== 'y' || !finite(c.radius, true) || !finite(c.height, true))
      fail('Invalid capsule collider');
    return;
  }
  if (shape === 'box') {
    const b = record(item, ['shape', 'center', 'size', 'min', 'max']);
    for (const k of ['center', 'size', 'min', 'max']) validateVec3Tuple(b[k]);
    return;
  }
  fail('Unknown collider shape');
};

const validateModelColliders = (raw: unknown): void => {
  const hasHz = isClosedContractRecord(raw) && 'hitzones' in raw;
  const col = record(
    raw,
    hasHz ? ['profile', 'aabb', 'colliders', 'hitzones'] : ['profile', 'aabb', 'colliders'],
  );
  if (!['creature', 'prop', 'block'].includes(String(col.profile)))
    fail('Invalid collider profile');
  const aabb = record(col.aabb, ['min', 'max']);
  validateVec3Tuple(aabb.min);
  validateVec3Tuple(aabb.max);
  if (!Array.isArray(col.colliders)) fail('Invalid colliders array');
  for (const item of col.colliders as unknown[]) validateColliderItem(item);
  if (!hasHz) return;
  if (!Array.isArray(col.hitzones)) fail('Invalid hitzones array');
  for (const hz of col.hitzones as unknown[]) validateHitZone(hz);
};

const validateDamageState = (raw: unknown): void => {
  if (!isClosedContractRecord(raw)) return fail('Invalid damageState');
  const keys = ['state'];
  if ('baseId' in raw) keys.push('baseId');
  if ('breakVfx' in raw) keys.push('breakVfx');
  if ('breakSound' in raw) keys.push('breakSound');
  if ('variants' in raw) keys.push('variants');
  const ds = record(raw, keys);
  if (!['intact', 'damaged', 'destroyed'].includes(String(ds.state)))
    fail('Invalid damageState.state');
};

const validateModelAsset = (
  a: Record<string, unknown>,
  reference: (path: unknown, extension: string) => void,
): void => {
  reference(a.model, '.glb');
  if (a.coordinateSystem !== 'gltf2' || !finite(a.unitsPerMeter, true) || !Array.isArray(a.clips))
    fail('Invalid model metadata');
  validateRequiredExtensions(a.requiredExtensions);
  for (const rawClip of a.clips as unknown[]) {
    const clip = record(rawClip, ['name', 'durationSeconds']);
    if (typeof clip.name !== 'string' || !clip.name || !finite(clip.durationSeconds, false))
      fail('Invalid animation clip');
  }
  if ('colliders' in a) validateModelColliders(a.colliders);
  if ('damageState' in a) validateDamageState(a.damageState);
};

const validateStructureAsset = (
  a: Record<string, unknown>,
  reference: (path: unknown, extension: string) => void,
): void => {
  reference(a.model, '.glb');
  reference(a.meta, '.structure.json');
  validateRequiredExtensions(a.requiredExtensions);
  if (
    a.coordinateSystem !== 'gltf2' ||
    a.unitsPerBlock !== 1 ||
    !Array.isArray(a.size) ||
    a.size.length !== 3 ||
    a.size.some((dim) => !Number.isSafeInteger(dim) || (dim as number) < 1) ||
    !isNonNegativeInt(a.zoneCount) ||
    !isNonNegativeInt(a.lightCount) ||
    !isNonNegativeInt(a.interactableCount)
  ) {
    fail('Invalid structure metadata');
  }
};

const BASE_VARIANT_KEYS = [
  'id',
  'file',
  'durationSeconds',
  'sample_rate',
  'sampleRate',
  'channels',
  'frames',
  'playback',
] as const;

const validateLoopFields = (
  v: Readonly<Record<string, unknown>>,
  playback: ReturnType<typeof readPlayback>,
  hasLoopFields: boolean,
): void => {
  if (playback.kind === 'loop') {
    if (
      !hasLoopFields ||
      v.loopStartSample !== playback.startFrame ||
      v.loopEndSample !== playback.endFrame
    ) {
      fail('Invalid loop sample metadata');
    }
    return;
  }
  if (hasLoopFields) fail('Unexpected loop sample metadata on oneshot variant');
};

const validateSoundVariant = (
  rawVariant: unknown,
  codec: string,
  variants: Set<string>,
  reference: (path: unknown, extension: string) => void,
  fileBytes: ReadonlyMap<string, number>,
): void => {
  const hasLoopFields =
    typeof rawVariant === 'object' &&
    rawVariant !== null &&
    ('loopStartSample' in rawVariant || 'loopEndSample' in rawVariant);
  const v = record(
    rawVariant,
    hasLoopFields ? [...BASE_VARIANT_KEYS, 'loopStartSample', 'loopEndSample'] : BASE_VARIANT_KEYS,
  );
  if (
    typeof v.id !== 'string' ||
    !v.id ||
    variants.has(v.id) ||
    !finite(v.durationSeconds, true) ||
    !Number.isSafeInteger(v.frames) ||
    (v.frames as number) < 2400 ||
    (v.frames as number) > 1440000 ||
    v.durationSeconds !== (v.frames as number) / 48000 ||
    v.sample_rate !== 48000 ||
    v.sampleRate !== 48000 ||
    (v.channels !== 1 && v.channels !== 2)
  ) {
    fail('Invalid sound variant');
  }
  validateLoopFields(v, readPlayback(v.playback, v.frames as number), hasLoopFields);
  if (codec === 'wav') {
    const byteLength = typeof v.file === 'string' ? fileBytes.get(v.file) : undefined;
    if (byteLength !== 44 + (v.frames as number) * 2 * (v.channels as number)) {
      fail('WAV frame count mismatch');
    }
  }
  variants.add(v.id as string);
  reference(v.file, '.' + codec);
};

const validateSoundAsset = (
  a: Record<string, unknown>,
  reference: (path: unknown, extension: string) => void,
  fileBytes: ReadonlyMap<string, number>,
): void => {
  const codec = String(a.codec);
  if (!['wav', 'ogg'].includes(codec) || !Array.isArray(a.variants) || !a.variants.length) {
    fail('Invalid audio metadata');
  }
  const variants = new Set<string>();
  for (const rawVariant of a.variants as unknown[]) {
    validateSoundVariant(rawVariant, codec, variants, reference, fileBytes);
  }
};

const fieldsForAssetKind = (
  kind: unknown,
  hasColliders = false,
  hasDamageState = false,
): readonly string[] => {
  if (kind === 'model') {
    const base = ['model', 'coordinateSystem', 'unitsPerMeter', 'clips', 'requiredExtensions'];
    if (hasColliders) base.push('colliders');
    if (hasDamageState) base.push('damageState');
    return base;
  }
  if (kind === 'structure')
    return [
      'model',
      'meta',
      'coordinateSystem',
      'unitsPerBlock',
      'requiredExtensions',
      'size',
      'zoneCount',
      'lightCount',
      'interactableCount',
    ];
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
  const a = record(raw, [
    'id',
    'kind',
    'files',
    ...fieldsForAssetKind(raw.kind, 'colliders' in raw, 'damageState' in raw),
  ]);
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
  else if (a.kind === 'structure') validateStructureAsset(a, reference);
  else if (a.kind === 'sprite') validateSpriteAsset(a, reference);
  else validateSoundAsset(a, reference, paths);
  if (referenced.length !== paths.size || new Set(referenced).size !== paths.size)
    fail('Incomplete file references');
};

const validateSharedTextures = (raw: unknown, allPaths: Set<string>): void => {
  if (!Array.isArray(raw) || !raw.length || raw.length > 8192)
    return fail('Invalid sharedTextures');
  for (const rawFile of raw as unknown[]) {
    const f = record(rawFile, ['path', 'sha256', 'byteLength']);
    const filePath = f.path;
    if (
      typeof filePath !== 'string' ||
      !safeRelative(filePath) ||
      !filePath.startsWith('textures/') ||
      !filePath.endsWith('.png') ||
      allPaths.has(filePath.toLowerCase()) ||
      typeof f.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(f.sha256) ||
      !Number.isSafeInteger(f.byteLength) ||
      (f.byteLength as number) < 0
    )
      return fail('Invalid shared texture record');
    allPaths.add(filePath.toLowerCase());
  }
};

/** Validate the generated runtime contract before consuming file references. */
export const readGameAssetManifest = (value: unknown): GameAssetManifest => {
  const hasShared = isClosedContractRecord(value) && 'sharedTextures' in value;
  const r = record(
    value,
    hasShared ? ['format', 'version', 'sharedTextures', 'assets'] : ['format', 'version', 'assets'],
  );
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
  if (hasShared) validateSharedTextures(r.sharedTextures, allPaths);
  return value as GameAssetManifest;
};
