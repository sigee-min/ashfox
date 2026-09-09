import { compilePack, type PackEncoder } from './packs';
import {
  compileDirectoryWorkspace, encodeCanonicalPng, exportProductionProjectResolved,
  openAssetProject, rasterizeTexture, type ExportAdapterInput
} from '@ashfox/engine-core';
import { BuildFailure, type Artifact, type CatalogAsset, type CompiledBundle, type Snapshot } from './contract';
import { digest, json } from './digest';
import { safeRelative } from './path';

export const checkSnapshot = (snapshot: Snapshot) => {
  const compiled = compileDirectoryWorkspace(snapshot.configuration, snapshot.files);
  if (!compiled.ok) throw new BuildFailure('workspace.compile', JSON.stringify(compiled.diagnostics));
  return compiled;
};
export const compileBundle = async (snapshot: Snapshot, toolchain: string, encoder?: PackEncoder): Promise<CompiledBundle> => {
  const compiled = checkSnapshot(snapshot), artifacts: Artifact[] = [], assets: CatalogAsset[] = [];
  for (const target of [...compiled.config.exports].sort((a, b) => a.name < b.name ? -1 : 1)) {
    const product = compiled.products.find(p => p.entry.packageName === target.entry.packageName && p.entry.entryName === target.entry.entryName);
    if (!product) throw new BuildFailure('export.entry', target.name);
    const files: Artifact[] = [];
    if (product.kind === 'sprite') files.push({ path: `${target.name}.png`, bytes: product.sprite.png });
    else if (product.kind === 'model') {
      const opened = openAssetProject({ workspace: product.workspace, entry: product.entry,
        identity: { id: 'cli', revision: compiled.buildKey, createdAt: '2000-01-01T00:00:00.000Z' } });
      if (!opened.ok) throw new BuildFailure('export.project', JSON.stringify(opened));
      const document = opened.project.document;
      const textures = new Map(Object.values(document.textures).map(texture => [texture.source.key,
        { bytes: encodeCanonicalPng(rasterizeTexture(document, texture)), contentType: 'image/png' }]));
      if (target.format === 'png' || target.format === 'wav') throw new BuildFailure('export.format', target.name);
      const adapter: ExportAdapterInput = 'namespace' in target ?
        { target: target.format, namespace: target.namespace, modelPath: target.modelPath } : { target: 'glb', modelPath: target.name };
      const bundle = await exportProductionProjectResolved(opened.project, adapter,
        { resolveBlob: async ref => textures.get(ref.key) ?? null,
          ...(target.format === 'glb' ? { encoding: target.encoding ?? 'portable' } : {}) });
      for (const file of bundle.files) {
        if (file.kind === 'blob-copy') throw new BuildFailure('export.unresolved', file.path);
        files.push({ path: file.path, bytes: file.kind === 'binary' ? file.data : new TextEncoder().encode(json(file.data)) });
      }
    } else {
      for (const sound of product.sounds) files.push({ path: `${target.name}/${sound.variant}.wav`, bytes: sound.wav });
    }
    const records = files.map(file => {
      if (!safeRelative(file.path)) throw new BuildFailure('export.path', file.path);
      const relative = `assets/${target.name}/${file.path}`;
      artifacts.push({ path: relative, bytes: file.bytes });
      return { path: relative, sha256: digest(file.bytes), byteLength: file.bytes.length };
    }).sort((a, b) => a.path < b.path ? -1 : 1);
    const metadata = product.kind === 'sprite' ? { width: product.sprite.receipt.width, height: product.sprite.receipt.height } :
      product.kind === 'model' ? { clips: Object.values(product.model.animations).map(clip => ({ name: clip.name, durationSeconds: clip.durationSeconds })) } :
      { variants: product.sounds.map(sound => ({ id: sound.variant, frames: sound.frames, sampleRate: sound.sampleRate, channels: sound.channels })) };
    assets.push({ id: target.name, kind: product.kind, directory: target.directory, files: records, metadata });
  }
  for (const pack of [...(compiled.config.packs ?? [])].sort((a, b) => a.name < b.name ? -1 : 1)) {
    const files = await compilePack(pack, assets, artifacts, encoder);
    const records = files.map(file => {
      const path = `assets/${pack.name}/${file.path}`;
      artifacts.push({ path, bytes: file.bytes });
      return { path, sha256: digest(file.bytes), byteLength: file.bytes.length };
    }).sort((a, b) => a.path < b.path ? -1 : 1);
    assets.push({ id: pack.name, kind: 'pack', directory: pack.directory, files: records,
      metadata: pack.format === 'minecraft_java' ?
        { minecraftVersion: pack.minecraftVersion, resourceRoot: 'resource-pack', archive: pack.archive ? `${pack.name}.zip` : null } :
        { resourceRoot: 'game-assets', manifest: 'assets.json', archive: pack.archive ? `${pack.name}.zip` : null } });
  }
  const effectiveToolchain = encoder ? json({ compiler: toolchain, vorbis: encoder.fingerprint }) : toolchain;
  const catalog = { format: 'ashfox-catalog' as const, version: 1 as const, assets };
  const catalogBytes = new TextEncoder().encode(json(catalog));
  artifacts.push({ path: 'catalog.json', bytes: catalogBytes });
  artifacts.sort((a, b) => a.path < b.path ? -1 : 1);
  const names = new Set(artifacts.map(file => file.path.toLowerCase()));
  if (names.size !== artifacts.length) throw new BuildFailure('export.collision', 'Duplicate output path');
  const receipt = { format: 'ashfox-build-receipt' as const, version: 1 as const,
    sourceHash: compiled.sourceHash, requestKey: digest(json({ buildKey: compiled.buildKey, toolchain: effectiveToolchain })), toolchain: effectiveToolchain,
    catalogHash: digest(catalogBytes),
    files: artifacts.map(file => ({ path: file.path, sha256: digest(file.bytes), byteLength: file.bytes.length })) };
  return { receipt, catalog, artifacts, bundleHash: digest('ashfox-bundle:1\n' + json(receipt)) };
};
