import { readResourcePacks } from './packRead';
import { readExportAdapterInput } from '../../export/adapter/input';
import { parseSpriteJson } from '../sprite/json';
import { SpriteInputError } from '../sprite/contract';
import { readWorkspaceManifest } from '../workspace';
import { deepFreeze } from '../../immutable';
import type { DirectoryWorkspace } from './contract';

export const directoryPath = (value: unknown): value is string => typeof value === 'string' &&
  value.length > 0 && value.length <= 240 && !value.startsWith('/') &&
  !/[\\:*?\[\]{}\x00-\x1f]/.test(value) && value.split('/').every(p => p !== '' && p !== '.' && p !== '..') &&
  value.normalize('NFC') === value;
const pattern = (value: unknown): value is string => typeof value === 'string' && value.length <= 240 &&
  value.length > 0 && !value.startsWith('/') && !value.startsWith('!') && !/[\\:\[\]{}\x00-\x1f]/.test(value) &&
  value.split('/').every(p => p !== '' && p !== '.' && p !== '..');
export const matchDirectoryPattern = (path: string, glob: string): boolean => {
  let expression = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*' && glob[i + 1] === '*') {
      i++; if (glob[i + 1] === '/') { i++; expression += '(?:.*/)?'; } else expression += '.*';
    } else if (c === '*') expression += '[^/]*';
    else if (c === '?') expression += '[^/]';
    else expression += c.replace(/[.+^$()|]/g, '\\$&');
  }
  return new RegExp(expression + '$').test(path);
};
export const isDirectorySource = (config: DirectoryWorkspace, path: string): boolean => {
  const excluded = ['.git', 'node_modules', '.ashfox', config.build.directory, ...config.exports.map(e => e.directory), ...(config.packs ?? []).map(p => p.directory)];
  if (excluded.some(p => path === p || path.startsWith(p + '/'))) return false;
  return path.endsWith('.ashfox') && config.include.some(p => matchDirectoryPattern(path, p)) &&
    !config.ignore.some(p => matchDirectoryPattern(path, p));
};
export const readDirectoryWorkspace = (source: string): DirectoryWorkspace => {
  const fail = (pointer: string, expected: string, actual: unknown): never => {
    throw new SpriteInputError({ code: 'workspace.config', file: '.ashfoxworkspace', pointer, expected, actual: String(actual) });
  };
  const record = (v: unknown, keys: readonly string[], p: string): Record<string, unknown> => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return fail(p, 'record', v);
    const r = v as Record<string, unknown>;
    if (Object.keys(r).length !== keys.length || keys.some(k => !Object.hasOwnProperty.call(r,k))) fail(p, keys.join(','), Object.keys(r));
    return r;
  };
  const parsed = parseSpriteJson(source, '.ashfoxworkspace');
  const hasPacks = parsed !== null && typeof parsed === 'object' && 'packs' in parsed;
  const r = record(parsed, ['format','version','name','packages','include','ignore','build','exports', ...(hasPacks ? ['packs'] : [])], '');
  if (r.format !== 'ashfox-workspace' || r.version !== 2) fail('/version', 'root configuration version 2; use import for embedded v1', r.version);
  if (typeof r.name !== 'string' || !/^[a-z][a-z0-9_-]{0,47}$/.test(r.name)) fail('/name', 'project name', r.name);
  const manifest = readWorkspaceManifest({ format:'ashfox-workspace', version:1, packages:r.packages });
  if (!manifest.ok) fail('/packages', 'valid package declarations', JSON.stringify(manifest.diagnostics));
  for (const field of ['include','ignore']) {
    const list = r[field];
    if (!Array.isArray(list) || list.length > 64 || list.some(g => !pattern(g))) fail('/'+field, 'up to 64 root-relative globs (*, **, ?)', list);
  }
  if ((r.include as unknown[]).length === 0) fail('/include', 'at least one pattern', 'empty');
  const build = record(r.build, ['directory'], '/build');
  if (!directoryPath(build.directory)) fail('/build/directory', 'non-root relative directory', build.directory);
  if (!Array.isArray(r.exports) || r.exports.length > 64) fail('/exports', 'up to 64 exports', r.exports);
  const names = new Set<string>(), directories = [(build.directory as string).toLowerCase()];
  (r.exports as unknown[]).forEach((v, i) => {
    const minecraft = v !== null && typeof v === 'object' && 'format' in v &&
      ['java_block','geckolib5','bedrock'].includes(String(v.format));
    const hasEncoding = v !== null && typeof v === 'object' && 'format' in v && v.format === 'glb' && 'encoding' in v;
    const e = record(v, minecraft ? ['name','entry','format','directory','namespace','modelPath'] :
      ['name','entry','format','directory', ...(hasEncoding ? ['encoding'] : [])], `/exports/${i}`);
    if (hasEncoding && !['portable','optimized'].includes(String(e.encoding))) fail(`/exports/${i}/encoding`, 'portable|optimized', e.encoding);
    if (minecraft) {
      try { readExportAdapterInput({ target: e.format, namespace: e.namespace, modelPath: e.modelPath }); }
      catch (error) { fail(`/exports/${i}`, 'valid Minecraft export adapter', error instanceof Error ? error.message : error); }
    }
    if (typeof e.name !== 'string' || !/^[a-z][a-z0-9_]{0,47}$/.test(e.name) || names.has(e.name)) fail(`/exports/${i}/name`, 'unique export id', e.name);
    names.add(e.name as string);
    if (!directoryPath(e.directory)) fail(`/exports/${i}/directory`, 'relative directory', e.directory);
    if (!['png','glb','wav','java_block','geckolib5','bedrock'].includes(String(e.format))) fail(`/exports/${i}/format`, 'png | glb | wav | java_block | geckolib5 | bedrock', e.format);
    const entry = record(e.entry, ['packageName','entryName'], `/exports/${i}/entry`);
    const pkg = manifest.ok ? manifest.value.packages.find(p => p.name === entry.packageName) : undefined;
    if (!pkg?.manifest.entries.some(a => a.name === entry.entryName)) fail(`/exports/${i}/entry`, 'declared entry', JSON.stringify(entry));
    directories.push((e.directory as string).toLowerCase());
  });
  const packs = readResourcePacks(r.packs, r.exports as DirectoryWorkspace['exports']);
  packs.forEach((pack, i) => {
    if (typeof pack.name !== 'string' || !/^[a-z][a-z0-9_]{0,47}$/.test(pack.name) || names.has(pack.name)) fail(`/packs/${i}/name`, 'unique export/pack id', pack.name);
    names.add(pack.name);
    if (!directoryPath(pack.directory)) fail(`/packs/${i}/directory`, 'relative directory', pack.directory);
    directories.push(pack.directory.toLowerCase());
  });
  if (directories.some((a,i) => ['.git','node_modules','.ashfox','.ashfoxworkspace'].some(b => a === b || a.startsWith(b+'/')) ||
    directories.some((b,j) => i !== j && (a === b || a.startsWith(b+'/'))))) fail('/build', 'disjoint output directories outside reserved paths', directories);
  if (!manifest.ok) return fail('/packages','valid packages','invalid');
  const result: DirectoryWorkspace = deepFreeze({
    format: 'ashfox-workspace', version: 2, name: r.name as string,
    packages: manifest.value.packages, include: r.include as string[], ignore: r.ignore as string[],
    build: { directory: build.directory as string }, exports: r.exports as DirectoryWorkspace['exports'], ...(hasPacks ? { packs } : {})
  });
  const roots = manifest.value.packages.map(p => p.root.toLowerCase());
  if (roots.some((a,i) => roots.some((b,j) => i !== j && (a === b || a === '' || b.startsWith(a+'/'))))) fail('/packages','disjoint package roots',roots);
  const declared = manifest.value.packages.flatMap(pkg => [...pkg.manifest.entries,...pkg.manifest.modules].map(e => [pkg.root,e.path].filter(Boolean).join('/')));
  if (new Set(declared.map(p=>p.toLowerCase())).size !== declared.length) fail('/packages','unique source paths',declared);
  if (!declared.length) fail('/packages','at least one entry','empty');
  for (const path of declared) if (!isDirectorySource(result,path)) fail('/include', 'declared source must be included, not ignored or under output', path);
  return result;
};
