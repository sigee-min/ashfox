import type { DirectoryExport } from './contract';
import type { GameAssetPack } from './pack';
import { SpriteInputError } from '../sprite/contract';
export const readGamePack = (value: unknown, exports: readonly DirectoryExport[], p: string): GameAssetPack => {
  const fail = (pointer: string, expected: string, actual: unknown): never => {
    throw new SpriteInputError({ code: 'workspace.config', file: '.ashfoxworkspace', pointer, expected, actual: String(actual) });
  };
  const record = (v: unknown, keys: readonly string[], pointer: string): Record<string, unknown> => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return fail(pointer, 'record', v);
    const r = v as Record<string, unknown>;
    if (Object.keys(r).length !== keys.length || keys.some(k => !Object.hasOwnProperty.call(r, k))) fail(pointer, keys.join(','), Object.keys(r));
    return r;
  };
  const r = record(value, ['name','format','directory','archive','audio','unitsPerMeter','pixelsPerUnit','spriteFilter','assets'], p);
  if (r.format !== 'game_assets') fail(p + '/format', 'game_assets', r.format);
  if (typeof r.archive !== 'boolean') fail(p + '/archive', 'boolean', r.archive);
  if (!['wav','ogg'].includes(String(r.audio))) fail(p + '/audio', 'wav|ogg', r.audio);
  if (!['nearest','linear'].includes(String(r.spriteFilter))) fail(p + '/spriteFilter', 'nearest|linear', r.spriteFilter);
  for (const f of ['unitsPerMeter','pixelsPerUnit']) {
    if (typeof r[f] !== 'number' || !Number.isFinite(r[f]) || r[f] <= 0 || r[f] > 65536) fail(p + '/' + f, 'positive finite number <= 65536', r[f]);
  }
  if (!Array.isArray(r.assets) || !r.assets.length) return fail(p + '/assets', 'nonempty array of bindings', r.assets);
  const ids = new Set<string>();
  r.assets.forEach((raw, index) => {
    const q = `${p}/assets/${index}`, a = record(raw, ['id','source','path'], q);
    if (typeof a.id !== 'string' || !/^[a-z][a-z0-9_.:/-]{0,127}$/.test(a.id) || ids.has(a.id)) fail(q + '/id', 'unique runtime asset id', a.id);
    ids.add(a.id as string);
    if (typeof a.path !== 'string' || a.path.length > 160 || !/^[a-z0-9_./-]+$/.test(a.path) ||
      a.path.split('/').some(s => !s || s === '.' || s === '..') || a.path === 'assets.json' || a.path.startsWith('assets.json/')) fail(q + '/path', 'safe relative directory outside assets.json', a.path);
    if (typeof a.source !== 'string' || !exports.some(e => e.name === a.source && ['glb','png','wav'].includes(e.format))) fail(q + '/source', 'named GLB, PNG or WAV export', a.source);
  });
  return value as GameAssetPack;
};
