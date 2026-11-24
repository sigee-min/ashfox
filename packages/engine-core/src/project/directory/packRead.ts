import { readGamePack } from './gameRead';
import type { DirectoryPack } from './pack';
import type { DirectoryExport } from './contract';
import {
  failWorkspaceConfig,
  isPackInteger,
  readClosedRecord,
  readConfigList,
  readConfigText,
  readExportSource,
  readResourceId,
} from './validate';

const MINECRAFT_PACK_KEYS = [
  'name',
  'format',
  'directory',
  'minecraftVersion',
  'metadata',
  'itemDefinitions',
  'archive',
  'icon',
  'models',
  'items',
  'sounds',
] as const;

const SOUND_KEYS = [
  'source',
  'id',
  'replace',
  'subtitle',
  'volume',
  'pitch',
  'stream',
  'variants',
] as const;

const isGameAssetsPack = (raw: unknown): boolean =>
  raw !== null && typeof raw === 'object' && 'format' in raw && raw.format === 'game_assets';

const readRangeBound = (
  meta: Record<string, unknown>,
  field: 'minFormat' | 'maxFormat',
  pointer: string,
): readonly number[] => {
  const value = meta[field];
  if (!Array.isArray(value) || value.length !== 2 || !value.every(isPackInteger)) {
    failWorkspaceConfig(`${pointer}/${field}`, '[major,minor] nonnegative integers', value);
  }
  return value as readonly number[];
};

const readPackMetadata = (value: unknown, pointer: string): void => {
  const modern =
    value !== null && typeof value === 'object' && 'format' in value && value.format === 'range';
  const keys = modern
    ? ['format', 'description', 'minFormat', 'maxFormat']
    : ['format', 'description', 'packFormat'];
  const meta = readClosedRecord(value, keys, pointer);
  readConfigText(meta.description, `${pointer}/description`);
  if (!modern) {
    if (meta.format !== 'legacy' || !isPackInteger(meta.packFormat)) {
      failWorkspaceConfig(pointer, 'legacy packFormat integer', meta);
    }
    return;
  }
  const min = readRangeBound(meta, 'minFormat', pointer);
  const max = readRangeBound(meta, 'maxFormat', pointer);
  if (min[0]! > max[0]! || (min[0] === max[0] && min[1]! > max[1]!)) {
    failWorkspaceConfig(pointer, 'ordered format range', meta);
  }
};

const readPackItem = (
  value: unknown,
  index: number,
  packPointer: string,
  exports: readonly DirectoryExport[],
  itemIds: Set<unknown>,
): void => {
  const pointer = `${packPointer}/items/${index}`;
  const item = readClosedRecord(value, ['source', 'id', 'parent'], pointer);
  readExportSource(item.source, exports, ['png'], `${pointer}/source`);
  readResourceId(item.id, `${pointer}/id`);
  if (!['generated', 'handheld'].includes(String(item.parent))) {
    failWorkspaceConfig(`${pointer}/parent`, 'generated|handheld', item.parent);
  }
  if (itemIds.has(item.id)) failWorkspaceConfig(`${pointer}/id`, 'unique item resource', item.id);
  itemIds.add(item.id);
};

const readSoundVariant = (
  value: unknown,
  index: number,
  variantsPointer: string,
  ids: Set<unknown>,
): void => {
  const variant = readClosedRecord(value, ['id', 'weight'], `${variantsPointer}/${index}`);
  if (
    typeof variant.id !== 'string' ||
    !/^[a-z][a-z0-9_]{0,31}$/.test(variant.id) ||
    ids.has(variant.id)
  ) {
    failWorkspaceConfig(variantsPointer, 'unique variant id', variant.id);
  }
  ids.add(variant.id);
  if (!isPackInteger(variant.weight) || variant.weight === 0) {
    failWorkspaceConfig(variantsPointer, 'positive integer weight', variant.weight);
  }
};

const checkSoundScalar = (
  sound: Record<string, unknown>,
  field: 'volume' | 'pitch',
  max: number,
  pointer: string,
): void => {
  const value = sound[field];
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > max) {
    failWorkspaceConfig(`${pointer}/${field}`, `number > 0 and <= ${max}`, value);
  }
};

const readPackSound = (
  value: unknown,
  index: number,
  packPointer: string,
  exports: readonly DirectoryExport[],
  soundIds: Set<unknown>,
): void => {
  const pointer = `${packPointer}/sounds/${index}`;
  const sound = readClosedRecord(value, SOUND_KEYS, pointer);
  readExportSource(sound.source, exports, ['wav'], `${pointer}/source`);
  readResourceId(sound.id, `${pointer}/id`);
  if (soundIds.has(sound.id)) failWorkspaceConfig(`${pointer}/id`, 'unique sound event', sound.id);
  soundIds.add(sound.id);
  if (typeof sound.replace !== 'boolean') {
    failWorkspaceConfig(`${pointer}/replace`, 'boolean', sound.replace);
  }
  if (typeof sound.stream !== 'boolean') {
    failWorkspaceConfig(`${pointer}/stream`, 'boolean', sound.stream);
  }
  if (sound.subtitle !== null) readConfigText(sound.subtitle, `${pointer}/subtitle`);
  checkSoundScalar(sound, 'volume', 1, pointer);
  checkSoundScalar(sound, 'pitch', 2, pointer);
  if (sound.variants === 'all') return;
  const variantsPointer = `${pointer}/variants`;
  const variants = readConfigList(sound.variants, variantsPointer);
  if (!variants.length) failWorkspaceConfig(variantsPointer, 'nonempty selection or all', variants);
  const ids = new Set<unknown>();
  variants.forEach((entry, variantIndex) =>
    readSoundVariant(entry, variantIndex, variantsPointer, ids),
  );
};

const readMinecraftPack = (
  raw: unknown,
  pointer: string,
  exports: readonly DirectoryExport[],
): void => {
  const record = readClosedRecord(raw, MINECRAFT_PACK_KEYS, pointer);
  if (record.format !== 'minecraft_java') {
    failWorkspaceConfig(`${pointer}/format`, 'minecraft_java', record.format);
  }
  readConfigText(record.minecraftVersion, `${pointer}/minecraftVersion`);
  if (!['modern', 'legacy'].includes(String(record.itemDefinitions))) {
    failWorkspaceConfig(`${pointer}/itemDefinitions`, 'modern|legacy', record.itemDefinitions);
  }
  if (typeof record.archive !== 'boolean') {
    failWorkspaceConfig(`${pointer}/archive`, 'boolean', record.archive);
  }
  if (record.icon !== null) readExportSource(record.icon, exports, ['png'], `${pointer}/icon`);
  readPackMetadata(record.metadata, `${pointer}/metadata`);
  const models = readConfigList(record.models, `${pointer}/models`);
  models.forEach((entry, index) =>
    readExportSource(entry, exports, ['java_block', 'geckolib5'], `${pointer}/models/${index}`),
  );
  if (new Set(models).size !== models.length) {
    failWorkspaceConfig(`${pointer}/models`, 'unique sources', models);
  }
  const itemIds = new Set<unknown>();
  readConfigList(record.items, `${pointer}/items`).forEach((entry, index) =>
    readPackItem(entry, index, pointer, exports, itemIds),
  );
  const soundIds = new Set<unknown>();
  readConfigList(record.sounds, `${pointer}/sounds`).forEach((entry, index) =>
    readPackSound(entry, index, pointer, exports, soundIds),
  );
};

/** Validates optional directory pack declarations against declared exports. */
export const readResourcePacks = (
  value: unknown,
  exports: readonly DirectoryExport[],
): readonly DirectoryPack[] => {
  if (value === undefined) return [];
  for (const [index, raw] of readConfigList(value, '/packs').entries()) {
    const pointer = `/packs/${index}`;
    if (isGameAssetsPack(raw)) readGamePack(raw, exports, pointer);
    else readMinecraftPack(raw, pointer, exports);
  }
  return value as readonly DirectoryPack[];
};
