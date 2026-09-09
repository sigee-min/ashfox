import { readGameAssetManifest } from '../runtimeRead';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BuildFailure, type Receipt, type Catalog, type FileRecord, type CatalogAsset, type AssetMetadata } from '../contract';
import { digest, json } from '../digest';
import { contained, listFiles, noLinks, safeRelative } from './paths';
const fail = (message: string): never => { throw new BuildFailure('output.integrity', message, 3); };
const record = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('Expected record');
  const r = value as Record<string, unknown>;
  if (Object.keys(r).length !== keys.length || keys.some(k => !Object.prototype.hasOwnProperty.call(r, k))) fail('Unexpected fields');
  return r;
};
const isHash = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
const readJson = (file: string): unknown => {
  noLinks(file);
  if (fs.statSync(file).size > 4 * 1024 * 1024) return fail('Oversized metadata');
  const text = fs.readFileSync(file, 'utf8'), value: unknown = JSON.parse(text);
  if (text !== json(value)) fail('Metadata must be canonical JSON');
  return value;
};
const metadata = (kind: unknown, value: unknown): AssetMetadata => {
  if (kind === 'pack') {
    if (value !== null && typeof value === 'object' && 'resourceRoot' in value && value.resourceRoot === 'game-assets') {
      const r = record(value, ['resourceRoot', 'manifest', 'archive']);
      if (r.manifest !== 'assets.json' || (r.archive !== null && (typeof r.archive !== 'string' || !safeRelative(r.archive) || !r.archive.endsWith('.zip')))) fail('Invalid game pack metadata');
      return { resourceRoot: 'game-assets', manifest: 'assets.json', archive: r.archive as string | null };
    }
    const r = record(value, ['minecraftVersion', 'resourceRoot', 'archive']);
    if (typeof r.minecraftVersion !== 'string' || !r.minecraftVersion || r.resourceRoot !== 'resource-pack' ||
      (r.archive !== null && (typeof r.archive !== 'string' || !safeRelative(r.archive) || !r.archive.endsWith('.zip')))) fail('Invalid pack metadata');
    return { minecraftVersion: r.minecraftVersion as string, resourceRoot: 'resource-pack', archive: r.archive as string | null };
  }
  if (kind === 'sprite') {
    const r = record(value, ['width', 'height']);
    if (r.width !== 16 || r.height !== 16) fail('Invalid sprite dimensions');
    return { width: 16, height: 16 };
  }
  if (kind === 'model') {
    const r = record(value, ['clips']); if (!Array.isArray(r.clips)) return fail('Invalid clips');
    return { clips: r.clips.map(raw => {
      const clip = record(raw, ['name', 'durationSeconds']);
      if (typeof clip.name !== 'string' || typeof clip.durationSeconds !== 'number' || !Number.isFinite(clip.durationSeconds) || clip.durationSeconds < 0) fail('Invalid clip');
      return { name: clip.name as string, durationSeconds: clip.durationSeconds as number };
    }) };
  }
  const r = record(value, ['variants']); if (!Array.isArray(r.variants)) return fail('Invalid variants');
  return { variants: r.variants.map(raw => {
    const variant = record(raw, ['id', 'frames', 'sampleRate', 'channels']);
    if (typeof variant.id !== 'string' || !Number.isSafeInteger(variant.frames) || (variant.frames as number) <= 0 ||
      variant.sampleRate !== 48000 || variant.channels !== 1) fail('Invalid audio metadata');
    return { id: variant.id as string, frames: variant.frames as number, sampleRate: 48000, channels: 1 };
  }) };
};
export const verifyBundle = (directory: string, hash: string): { receipt: Receipt; catalog: Catalog } => {
  noLinks(directory);
  if (!isHash(hash)) return fail('Invalid bundle hash');
  const r = record(readJson(path.join(directory, 'receipt.json')),
    ['format', 'version', 'sourceHash', 'requestKey', 'toolchain', 'catalogHash', 'files']);
  if (r.format !== 'ashfox-build-receipt' || r.version !== 1 || typeof r.sourceHash !== 'string' ||
    !isHash(r.requestKey) || !isHash(r.catalogHash) || typeof r.toolchain !== 'string' || !Array.isArray(r.files)) fail('Invalid receipt');
  if (digest('ashfox-bundle:1\n' + json(r)) !== hash) fail('Receipt hash mismatch');
  const names: string[] = [], fileRecords: FileRecord[] = [];
  for (const raw of r.files as unknown[]) {
    const file = record(raw, ['path', 'sha256', 'byteLength']);
    if (typeof file.path !== 'string' || !safeRelative(file.path) || !isHash(file.sha256) ||
      !Number.isSafeInteger(file.byteLength) || (file.byteLength as number) < 0 || (file.byteLength as number) > 128 * 1024 * 1024) fail('Invalid file record');
    const relative = file.path as string;
    if (relative === 'receipt.json') fail('Self-referential receipt');
    const target = contained(directory, relative); noLinks(target);
    if (fs.statSync(target).size !== file.byteLength || digest(fs.readFileSync(target)) !== file.sha256) fail('Artifact mismatch: ' + relative);
    names.push(relative); fileRecords.push({ path: relative, sha256: file.sha256 as string, byteLength: file.byteLength as number });
  }
  if (new Set(names.map(n => n.toLowerCase())).size !== names.length || json(names) !== json([...names].sort())) fail('Duplicate or unordered files');
  if (json(listFiles(directory)) !== json([...names, 'receipt.json'].sort())) fail('Missing or additional files');
  const c = record(readJson(path.join(directory, 'catalog.json')), ['format', 'version', 'assets']);
  if (c.format !== 'ashfox-catalog' || c.version !== 1 || !Array.isArray(c.assets) || digest(json(c)) !== r.catalogHash) fail('Invalid catalog');
  const ids = new Set<string>(), referenced: string[] = [], assets: CatalogAsset[] = [];
  for (const raw of c.assets as unknown[]) {
    const asset = record(raw, ['id', 'kind', 'directory', 'files', 'metadata']);
    if (typeof asset.id !== 'string' || !/^[a-z][a-z0-9_]{0,47}$/u.test(asset.id) || ids.has(asset.id) ||
      !['model', 'sprite', 'sound', 'pack'].includes(String(asset.kind)) || typeof asset.directory !== 'string' || !safeRelative(asset.directory) || !Array.isArray(asset.files)) fail('Invalid asset');
    ids.add(asset.id as string); const assetFiles: FileRecord[] = [];
    for (const rawFile of asset.files as unknown[]) {
      const file = record(rawFile, ['path', 'sha256', 'byteLength']);
      if (typeof file.path !== 'string' || !file.path.startsWith(`assets/${asset.id}/`) ||
        !(r.files as unknown[]).some(f => json(f) === json(file))) fail('Catalog lineage mismatch');
      referenced.push(file.path as string); assetFiles.push(fileRecords.find(f => f.path === file.path)!);
    }
    const details = metadata(asset.kind, asset.metadata);
    if (asset.kind === 'pack' && 'resourceRoot' in details) {
      const prefix = `assets/${asset.id}/`;
      const root = prefix + details.resourceRoot + '/';
      const entry = details.resourceRoot === 'resource-pack' ? 'pack.mcmeta' : details.manifest;
      if (!assetFiles.some(f => f.path === root + entry) ||
        (details.archive !== null && !assetFiles.some(f => f.path === prefix + details.archive)) ||
        assetFiles.some(f => !f.path.startsWith(root) && f.path !== prefix + details.archive)) fail('Invalid pack file coverage');
      if (details.resourceRoot === 'game-assets') {
        const manifest = readGameAssetManifest(readJson(contained(directory, root + details.manifest)));
        const references = manifest.assets.flatMap(a => a.files).map(f => ({ ...f, path: root + f.path })).sort((a, b) => a.path < b.path ? -1 : 1);
        const actual = assetFiles.filter(f => f.path.startsWith(root) && f.path !== root + details.manifest).sort((a, b) => a.path < b.path ? -1 : 1);
        if (json(references) !== json(actual)) fail('Game manifest lineage mismatch');
      }
    }
    assets.push({ id: asset.id as string, kind: asset.kind as CatalogAsset['kind'], directory: asset.directory as string, files: assetFiles, metadata: details });
  }
  if (json(referenced.sort()) !== json(names.filter(n => n !== 'catalog.json'))) fail('Catalog coverage mismatch');
  return { receipt: { format: 'ashfox-build-receipt', version: 1, sourceHash: r.sourceHash as string,
    requestKey: r.requestKey as string, toolchain: r.toolchain as string, catalogHash: r.catalogHash as string, files: fileRecords },
    catalog: { format: 'ashfox-catalog', version: 1, assets } };
};
export const verifyCurrent = (output: string) => {
  output = path.join(fs.realpathSync(path.dirname(path.resolve(output))), path.basename(output));
  noLinks(output);
  const current = record(readJson(path.join(output, 'current.json')), ['format', 'version', 'bundleHash']);
  if (current.format !== 'ashfox-current' || current.version !== 1 || !isHash(current.bundleHash)) return fail('Invalid pointer');
  const hash = current.bundleHash as string, directory = path.join(output, 'bundles', hash);
  return { bundleHash: hash, bundlePath: directory, ...verifyBundle(directory, hash) };
};
