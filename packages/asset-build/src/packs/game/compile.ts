import { readGameAssetManifest } from './read';
import type { GameAssetPack } from '@ashfox/engine-core';
import {
  BuildFailure,
  type Artifact,
  type CatalogAsset,
  type PackEncoder,
} from '../../bundle/contract';
import type { GameAssetManifest, RuntimeAsset } from './contract';
import { digest, json } from '../../shared/digest';
import { archivePack } from '../archive';
export const compileGamePack = async (
  pack: GameAssetPack,
  assets: readonly CatalogAsset[],
  artifacts: readonly Artifact[],
  encoder?: PackEncoder,
): Promise<readonly Artifact[]> => {
  const files: Artifact[] = [],
    runtime: RuntimeAsset[] = [],
    encoded = new Map<string, Uint8Array>();
  const read = (path: string): Uint8Array => {
    const file = artifacts.find((f) => f.path === path);
    if (!file) throw new BuildFailure('pack.source', path);
    return file.bytes;
  };
  for (const binding of [...pack.assets].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const source = assets.find((a) => a.id === binding.source);
    if (!source || source.kind === 'pack') throw new BuildFailure('pack.source', binding.source);
    const mapped: Artifact[] = [];
    const add = (name: string, bytes: Uint8Array): string => {
      const path = `${binding.path}/${name}`;
      mapped.push({ path, bytes });
      return path;
    };
    let detail:
      | Omit<Extract<RuntimeAsset, { kind: 'model' }>, 'files'>
      | Omit<Extract<RuntimeAsset, { kind: 'sprite' }>, 'files'>
      | Omit<Extract<RuntimeAsset, { kind: 'sound' }>, 'files'>;
    if (source.kind === 'sound' && 'variants' in source.metadata) {
      const variants = [];
      for (const variant of source.metadata.variants) {
        const file = source.files.find((f) => f.path.endsWith(`/${variant.id}.wav`));
        if (!file) throw new BuildFailure('pack.source', `${source.id}/${variant.id}`);
        let data = read(file.path);
        if (pack.audio === 'ogg') {
          if (variant.playback.kind === 'loop')
            throw new BuildFailure('sound.loop.codec', `${source.id}/${variant.id}: loops require WAV delivery`);
          if (!encoder)
            throw new BuildFailure('pack.encoder', 'OGG game assets require a Vorbis encoder');
          let ogg = encoded.get(file.path);
          if (!ogg) {
            ogg = await encoder.encode(data);
            encoded.set(file.path, ogg);
          }
          data = ogg;
        }
        variants.push({
          id: variant.id,
          file: add(`${variant.id}.${pack.audio}`, data),
          durationSeconds: variant.frames / variant.sampleRate,
          sampleRate: variant.sampleRate,
          channels: variant.channels,
          frames: variant.frames,
          playback: variant.playback,
        });
      }
      detail = { id: binding.id, kind: 'sound', codec: pack.audio, variants };
    } else if (source.kind === 'sprite' && 'width' in source.metadata) {
      const file = source.files.find((f) => f.path.endsWith('.png'));
      if (!file) throw new BuildFailure('pack.source', source.id);
      detail = {
        id: binding.id,
        kind: 'sprite',
        image: add(`${source.id}.png`, read(file.path)),
        width: source.metadata.width,
        height: source.metadata.height,
        pixelsPerUnit: pack.pixelsPerUnit,
        filter: pack.spriteFilter,
      };
    } else if (source.kind === 'model' && 'clips' in source.metadata) {
      const file = source.files.find((f) => f.path.endsWith('.glb'));
      if (!file) throw new BuildFailure('pack.source', source.id + ': expected embedded GLB');
      const data = read(file.path),
        view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const gltf = JSON.parse(
        new TextDecoder().decode(data.slice(20, 20 + view.getUint32(12, true))),
      ) as { extensionsRequired?: string[] };
      detail = {
        id: binding.id,
        kind: 'model',
        model: add(`${source.id}.glb`, data),
        requiredExtensions: gltf.extensionsRequired ?? [],
        coordinateSystem: 'gltf2',
        unitsPerMeter: pack.unitsPerMeter,
        clips: source.metadata.clips,
      };
    } else throw new BuildFailure('pack.source', source.id + ': unsupported metadata');
    files.push(...mapped);
    runtime.push({
      ...detail,
      files: mapped.map((f) => ({
        path: f.path,
        sha256: digest(f.bytes),
        byteLength: f.bytes.length,
      })),
    });
  }
  const manifest: GameAssetManifest = { format: 'ashfox-game-assets', version: 1, assets: runtime };
  readGameAssetManifest(manifest);
  files.push({ path: 'assets.json', bytes: new TextEncoder().encode(json(manifest)) });
  return archivePack(pack.name, 'game-assets', pack.archive, files);
};
