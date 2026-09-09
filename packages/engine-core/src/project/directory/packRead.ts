import { readGamePack } from './gameRead';
import type { DirectoryPack } from './pack';
import type { DirectoryExport } from './contract';
import { SpriteInputError } from '../sprite/contract';
const fail = (pointer: string, expected: string, actual: unknown): never => {
  throw new SpriteInputError({ code: 'workspace.config', file: '.ashfoxworkspace', pointer, expected, actual: String(actual) });
};
const record = (value: unknown, keys: readonly string[], pointer: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(pointer, 'record', value);
  const r = value as Record<string, unknown>;
  if (Object.keys(r).length !== keys.length || keys.some(k => !Object.hasOwnProperty.call(r, k))) fail(pointer, keys.join(','), Object.keys(r));
  return r;
};
const list = (value: unknown, p: string): readonly unknown[] => {
  if (!Array.isArray(value) || value.length > 64) return fail(p, 'array with at most 64 entries', value);
  return value;
};
const text = (value: unknown, p: string): void => {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) fail(p, 'nonempty text, at most 256 characters', value);
};
const resource = (value: unknown, p: string): void => {
  if (typeof value !== 'string' || value.length > 160 || !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(value) ||
    ['.', '..'].includes(value.split(':')[0]!) ||
    value.split(':')[1]!.split('/').some(part => !part || part === '.' || part === '..')) fail(p, 'namespace:relative/resource', value);
};
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= 65535;
export const readResourcePacks = (value: unknown, exports: readonly DirectoryExport[]): readonly DirectoryPack[] => {
  if (value === undefined) return [];
  const source = (v: unknown, formats: readonly string[], p: string): void => {
    if (typeof v !== 'string' || !exports.some(e => e.name === v && formats.includes(e.format))) fail(p, 'named export of format ' + formats.join('|'), v);
  };
  for (const [i, raw] of list(value, '/packs').entries()) {
    const p = `/packs/${i}`;
    if (raw !== null && typeof raw === 'object' && 'format' in raw && raw.format === 'game_assets') {
      readGamePack(raw, exports, p); continue;
    }
    const r = record(raw, ['name','format','directory','minecraftVersion','metadata','itemDefinitions','archive','icon','models','items','sounds'], p);
    if (r.format !== 'minecraft_java') fail(p + '/format', 'minecraft_java', r.format);
    text(r.minecraftVersion, p + '/minecraftVersion');
    if (!['modern','legacy'].includes(String(r.itemDefinitions))) fail(p + '/itemDefinitions', 'modern|legacy', r.itemDefinitions);
    if (typeof r.archive !== 'boolean') fail(p + '/archive', 'boolean', r.archive);
    if (r.icon !== null) source(r.icon, ['png'], p + '/icon');
    const modern = r.metadata !== null && typeof r.metadata === 'object' && 'format' in r.metadata && r.metadata.format === 'range';
    const m = record(r.metadata, modern ? ['format','description','minFormat','maxFormat'] : ['format','description','packFormat'], p + '/metadata');
    text(m.description, p + '/metadata/description');
    if (modern) {
      for (const field of ['minFormat','maxFormat']) {
        const v = m[field];
        if (!Array.isArray(v) || v.length !== 2 || !v.every(integer)) fail(p + '/metadata/' + field, '[major,minor] nonnegative integers', v);
      }
      const min = m.minFormat as number[], max = m.maxFormat as number[];
      if (min[0]! > max[0]! || (min[0] === max[0] && min[1]! > max[1]!)) fail(p + '/metadata', 'ordered format range', m);
    } else if (m.format !== 'legacy' || !integer(m.packFormat)) fail(p + '/metadata', 'legacy packFormat integer', m);
    const models = list(r.models, p + '/models');
    models.forEach((v, n) => source(v, ['java_block','geckolib5'], `${p}/models/${n}`));
    if (new Set(models).size !== models.length) fail(p + '/models', 'unique sources', models);
    const itemIds = new Set<unknown>(), soundIds = new Set<unknown>();
    list(r.items, p + '/items').forEach((v, n) => {
      const q = `${p}/items/${n}`, item = record(v, ['source','id','parent'], q);
      source(item.source, ['png'], q + '/source'); resource(item.id, q + '/id');
      if (!['generated','handheld'].includes(String(item.parent))) fail(q + '/parent', 'generated|handheld', item.parent);
      if (itemIds.has(item.id)) fail(q + '/id', 'unique item resource', item.id);
      itemIds.add(item.id);
    });
    list(r.sounds, p + '/sounds').forEach((v, n) => {
      const q = `${p}/sounds/${n}`, sound = record(v, ['source','id','replace','subtitle','volume','pitch','stream','variants'], q);
      source(sound.source, ['wav'], q + '/source'); resource(sound.id, q + '/id');
      if (soundIds.has(sound.id)) fail(q + '/id', 'unique sound event', sound.id);
      soundIds.add(sound.id);
      for (const f of ['replace','stream']) if (typeof sound[f] !== 'boolean') fail(q + '/' + f, 'boolean', sound[f]);
      if (sound.subtitle !== null) text(sound.subtitle, q + '/subtitle');
      for (const [f, max] of [['volume',1],['pitch',2]] as const) {
        if (typeof sound[f] !== 'number' || !Number.isFinite(sound[f]) || sound[f] <= 0 || sound[f] > max) fail(q + '/' + f, `number > 0 and <= ${max}`, sound[f]);
      }
      if (sound.variants !== 'all') {
        const variants = list(sound.variants, q + '/variants'), ids = new Set<unknown>();
        if (!variants.length) fail(q + '/variants', 'nonempty selection or all', variants);
        variants.forEach((v, j) => {
          const variant = record(v, ['id','weight'], `${q}/variants/${j}`);
          if (typeof variant.id !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/.test(variant.id) || ids.has(variant.id)) fail(q + '/variants', 'unique variant id', variant.id);
          ids.add(variant.id);
          if (!integer(variant.weight) || variant.weight === 0) fail(q + '/variants', 'positive integer weight', variant.weight);
        });
      }
    });
  }
  return value as readonly DirectoryPack[];
};
