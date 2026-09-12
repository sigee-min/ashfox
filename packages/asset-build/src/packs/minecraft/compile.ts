import type { JavaResourcePack } from '@ashfox/engine-core';
import { archivePack } from '../archive';
import {
  BuildFailure,
  type Artifact,
  type CatalogAsset,
  type PackEncoder,
} from '../../bundle/contract';
import { json } from '../../shared/digest';
import { safeRelative } from '../../shared/path';
export const compileJavaPack = async (
  pack: JavaResourcePack,
  assets: readonly CatalogAsset[],
  artifacts: readonly Artifact[],
  encoder?: PackEncoder,
): Promise<readonly Artifact[]> => {
  const files = new Map<string, Artifact>();
  const add = (path: string, bytes: Uint8Array): void => {
    const key = path.toLowerCase();
    if (!safeRelative(path) || files.has(key))
      throw new BuildFailure('pack.collision', `${pack.name}: ${path}`);
    files.set(key, { path, bytes });
  };
  const addJson = (path: string, value: unknown): void =>
    add(path, new TextEncoder().encode(json(value)));
  const asset = (id: string): CatalogAsset => {
    const found = assets.find((a) => a.id === id);
    if (!found) throw new BuildFailure('pack.source', `${pack.name}: missing export ${id}`);
    return found;
  };
  const bytes = (path: string): Uint8Array => {
    const found = artifacts.find((a) => a.path === path);
    if (!found) throw new BuildFailure('pack.source', path);
    return found.bytes;
  };
  const png = (id: string): Uint8Array => {
    const source = asset(id),
      file = source.files.find((f) => f.path.endsWith('.png'));
    if (source.kind !== 'sprite' || !file)
      throw new BuildFailure('pack.source', id + ': expected sprite');
    return bytes(file.path);
  };
  const metadata = pack.metadata;
  addJson('pack.mcmeta', {
    pack:
      metadata.format === 'legacy'
        ? { pack_format: metadata.packFormat, description: metadata.description }
        : {
            min_format: metadata.minFormat,
            max_format: metadata.maxFormat,
            description: metadata.description,
          },
  });
  if (pack.icon !== null) add('pack.png', png(pack.icon));
  for (const source of [...pack.models].sort()) {
    for (const file of asset(source).files) {
      const relative = file.path.slice(`assets/${source}/`.length);
      // Pack metadata is owned by this declaration, not by individual block exports.
      if (relative !== 'pack.mcmeta') add(relative, bytes(file.path));
    }
  }
  for (const item of [...pack.items].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const [namespace, path] = item.id.split(':');
    add(`assets/${namespace}/textures/item/${path}.png`, png(item.source));
    addJson(`assets/${namespace}/models/item/${path}.json`, {
      parent: `minecraft:item/${item.parent}`,
      textures: { layer0: `${namespace}:item/${path}` },
    });
    if (pack.itemDefinitions === 'modern')
      addJson(`assets/${namespace}/items/${path}.json`, {
        model: { type: 'minecraft:model', model: `${namespace}:item/${path}` },
      });
  }
  const sounds = new Map<string, Map<string, unknown>>(),
    encoded = new Map<string, Uint8Array>();
  for (const sound of [...pack.sounds].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!encoder)
      throw new BuildFailure('pack.encoder', 'Sound packs require the Node Vorbis encoder adapter');
    const source = asset(sound.source);
    if (!('variants' in source.metadata))
      throw new BuildFailure('pack.source', sound.source + ': expected sound');
    const selected =
      sound.variants === 'all'
        ? source.metadata.variants.map((v) => ({ id: v.id, weight: 1 }))
        : sound.variants;
    const [namespace, event] = sound.id.split(':');
    const entries = [];
    for (const variant of [...selected].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (!source.metadata.variants.some((v) => v.id === variant.id))
        throw new BuildFailure('pack.variant', `${sound.source}: ${variant.id}`);
      const file = source.files.find((f) => f.path.endsWith(`/${variant.id}.wav`));
      if (!file) throw new BuildFailure('pack.source', sound.source + ': missing WAV');
      let ogg = encoded.get(file.path);
      if (!ogg) {
        ogg = await encoder.encode(bytes(file.path));
        encoded.set(file.path, ogg);
      }
      const resource = `${event}/${variant.id}`;
      add(`assets/${namespace}/sounds/${resource}.ogg`, ogg);
      entries.push({
        name: `${namespace}:${resource}`,
        volume: sound.volume,
        pitch: sound.pitch,
        stream: sound.stream,
        weight: variant.weight,
      });
    }
    const events = sounds.get(namespace!) ?? new Map<string, unknown>();
    events.set(event!, {
      replace: sound.replace,
      ...(sound.subtitle === null ? {} : { subtitle: sound.subtitle }),
      sounds: entries,
    });
    sounds.set(namespace!, events);
  }
  for (const [namespace, events] of sounds)
    addJson(`assets/${namespace}/sounds.json`, Object.fromEntries(events));
  return archivePack(pack.name, 'resource-pack', pack.archive, [...files.values()]);
};
