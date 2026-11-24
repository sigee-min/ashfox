import type { DirectoryExport } from './contract';
import type { GameAssetPack } from './pack';
import { failWorkspaceConfig, readClosedRecord } from './validate';

const GAME_PACK_KEYS = [
  'name',
  'format',
  'directory',
  'archive',
  'audio',
  'unitsPerMeter',
  'pixelsPerUnit',
  'spriteFilter',
  'assets',
] as const;

const isSafeAssetPath = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length > 160 || !/^[a-z0-9_./-]+$/.test(value)) {
    return false;
  }
  if (value === 'assets.json' || value.startsWith('assets.json/')) return false;
  return !value.split('/').some((segment) => !segment || segment === '.' || segment === '..');
};

const checkScaleFactor = (
  record: Record<string, unknown>,
  field: string,
  pointer: string,
): void => {
  const value = record[field];
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 65536) {
    failWorkspaceConfig(`${pointer}/${field}`, 'positive finite number <= 65536', value);
  }
};

const readGameAsset = (
  raw: unknown,
  index: number,
  packPointer: string,
  exports: readonly DirectoryExport[],
  ids: Set<string>,
): void => {
  const pointer = `${packPointer}/assets/${index}`;
  const asset = readClosedRecord(raw, ['id', 'source', 'path'], pointer);
  const id = asset.id;
  if (typeof id !== 'string' || !/^[a-z][a-z0-9_.:/-]{0,127}$/.test(id) || ids.has(id)) {
    return failWorkspaceConfig(`${pointer}/id`, 'unique runtime asset id', id);
  }
  ids.add(id);
  if (!isSafeAssetPath(asset.path)) {
    failWorkspaceConfig(
      `${pointer}/path`,
      'safe relative directory outside assets.json',
      asset.path,
    );
  }
  const matches = (entry: DirectoryExport): boolean =>
    entry.name === asset.source && ['glb', 'png', 'wav'].includes(entry.format);
  if (typeof asset.source !== 'string' || !exports.some(matches)) {
    failWorkspaceConfig(`${pointer}/source`, 'named GLB, PNG or WAV export', asset.source);
  }
};

/** Validates a `game_assets` pack declaration against declared exports. */
export const readGamePack = (
  value: unknown,
  exports: readonly DirectoryExport[],
  pointer: string,
): GameAssetPack => {
  const record = readClosedRecord(value, GAME_PACK_KEYS, pointer);
  if (record.format !== 'game_assets') {
    failWorkspaceConfig(`${pointer}/format`, 'game_assets', record.format);
  }
  if (typeof record.archive !== 'boolean') {
    failWorkspaceConfig(`${pointer}/archive`, 'boolean', record.archive);
  }
  if (!['wav', 'ogg'].includes(String(record.audio))) {
    failWorkspaceConfig(`${pointer}/audio`, 'wav|ogg', record.audio);
  }
  if (!['nearest', 'linear'].includes(String(record.spriteFilter))) {
    failWorkspaceConfig(`${pointer}/spriteFilter`, 'nearest|linear', record.spriteFilter);
  }
  checkScaleFactor(record, 'unitsPerMeter', pointer);
  checkScaleFactor(record, 'pixelsPerUnit', pointer);
  if (!Array.isArray(record.assets) || !record.assets.length) {
    return failWorkspaceConfig(`${pointer}/assets`, 'nonempty array of bindings', record.assets);
  }
  const ids = new Set<string>();
  record.assets.forEach((raw, index) => readGameAsset(raw, index, pointer, exports, ids));
  return value as GameAssetPack;
};
