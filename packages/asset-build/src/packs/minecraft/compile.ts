import type { JavaResourcePack } from '@ashfox/engine-core';
import { compareText, encodeUtf8 } from '@ashfox/internal-contracts';
import { archivePack } from '../archive';
import {
  BuildFailure,
  type Artifact,
  type CatalogAsset,
  type PackEncoder,
} from '../../bundle/contract';
import { json } from '../../shared/digest';
import { safeRelative } from '../../shared/path';
import { indexCatalogAssetFiles } from '../sourceIndex';

interface PackWriter {
  add: (filePath: string, content: Uint8Array) => void;
  addJson: (filePath: string, value: unknown) => void;
  asset: (id: string) => CatalogAsset;
  bytes: (filePath: string) => Uint8Array;
  png: (id: string) => Uint8Array;
  wav: (id: string, variantId: string) => string | undefined;
  files: Artifact[];
}

const createPackWriter = (
  packName: string,
  assets: readonly CatalogAsset[],
  artifacts: readonly Artifact[],
): PackWriter => {
  const fileMap = new Map<string, Artifact>();
  const assetMap = new Map(assets.map((item) => [item.id, item]));
  const artifactMap = new Map(artifacts.map((item) => [item.path, item.bytes]));
  const sourceIndex = new Map(assets.map((item) => [item.id, indexCatalogAssetFiles(item)]));
  const add = (filePath: string, content: Uint8Array): void => {
    const key = filePath.toLowerCase();
    if (!safeRelative(filePath) || fileMap.has(key))
      throw new BuildFailure('pack.collision', `${packName}: ${filePath}`);
    fileMap.set(key, { path: filePath, bytes: content });
  };
  const asset = (id: string): CatalogAsset => {
    const found = assetMap.get(id);
    if (!found) throw new BuildFailure('pack.source', `${packName}: missing export ${id}`);
    return found;
  };
  const bytes = (filePath: string): Uint8Array => {
    const found = artifactMap.get(filePath);
    if (!found) throw new BuildFailure('pack.source', filePath);
    return found;
  };
  const png = (id: string): Uint8Array => {
    const source = asset(id);
    const pngPath = sourceIndex.get(id)?.pngPath;
    if (source.kind !== 'sprite' || !pngPath)
      throw new BuildFailure('pack.source', id + ': expected sprite');
    return bytes(pngPath);
  };
  return {
    add,
    addJson: (filePath, value) => add(filePath, encodeUtf8(json(value))),
    asset,
    bytes,
    png,
    wav: (id, variantId) => sourceIndex.get(id)?.wavPaths.get(variantId),
    get files() {
      return [...fileMap.values()];
    },
  };
};

const appendSoundEventVariants = async (
  sound: JavaResourcePack['sounds'][number],
  writer: PackWriter,
  encoded: Map<string, Uint8Array>,
  encoder?: PackEncoder,
) => {
  if (!encoder)
    throw new BuildFailure('pack.encoder', 'Sound packs require the Node Vorbis encoder adapter');
  const source = writer.asset(sound.source);
  if (!('variants' in source.metadata))
    throw new BuildFailure('pack.source', sound.source + ': expected sound');
  if (source.metadata.variants.some((v) => v.playback.kind === 'loop'))
    throw new BuildFailure(
      'sound.loop.target',
      sound.source + ': Minecraft sound events do not support loop playback',
    );
  const validVariantIds = new Set(source.metadata.variants.map((v) => v.id));
  const selected =
    sound.variants === 'all'
      ? source.metadata.variants.map((v) => ({ id: v.id, weight: 1 }))
      : sound.variants;
  const [namespace, event] = sound.id.split(':');
  const entries = [];
  for (const variant of [...selected].sort((a, b) => compareText(a.id, b.id))) {
    if (!validVariantIds.has(variant.id))
      throw new BuildFailure('pack.variant', `${sound.source}: ${variant.id}`);
    const filePath = writer.wav(sound.source, variant.id);
    if (!filePath) throw new BuildFailure('pack.source', sound.source + ': missing WAV');
    let ogg = encoded.get(filePath);
    if (!ogg) {
      ogg = await encoder.encode(writer.bytes(filePath));
      encoded.set(filePath, ogg);
    }
    const resource = `${event}/${variant.id}`;
    writer.add(`assets/${namespace}/sounds/${resource}.ogg`, ogg);
    entries.push({
      name: `${namespace}:${resource}`,
      volume: sound.volume,
      pitch: sound.pitch,
      stream: sound.stream,
      weight: variant.weight,
    });
  }
  return { namespace: namespace!, event: event!, entries };
};

const appendPackAssets = (pack: JavaResourcePack, writer: PackWriter): void => {
  const metadata = pack.metadata;
  writer.addJson('pack.mcmeta', {
    pack:
      metadata.format === 'legacy'
        ? { pack_format: metadata.packFormat, description: metadata.description }
        : {
            min_format: metadata.minFormat,
            max_format: metadata.maxFormat,
            description: metadata.description,
          },
  });
  if (pack.icon !== null) writer.add('pack.png', writer.png(pack.icon));
  for (const source of [...pack.models].sort(compareText)) {
    for (const file of writer.asset(source).files) {
      const relative = file.path.slice(`assets/${source}/`.length);
      // Pack metadata is owned by this declaration, not by individual block exports.
      if (relative !== 'pack.mcmeta') writer.add(relative, writer.bytes(file.path));
    }
  }
  for (const item of [...pack.items].sort((a, b) => compareText(a.id, b.id))) {
    const [namespace, itemPath] = item.id.split(':');
    writer.add(`assets/${namespace}/textures/item/${itemPath}.png`, writer.png(item.source));
    writer.addJson(`assets/${namespace}/models/item/${itemPath}.json`, {
      parent: `minecraft:item/${item.parent}`,
      textures: { layer0: `${namespace}:item/${itemPath}` },
    });
    if (pack.itemDefinitions === 'modern')
      writer.addJson(`assets/${namespace}/items/${itemPath}.json`, {
        model: { type: 'minecraft:model', model: `${namespace}:item/${itemPath}` },
      });
  }
};

export const compileJavaPack = async (
  pack: JavaResourcePack,
  assets: readonly CatalogAsset[],
  artifacts: readonly Artifact[],
  encoder?: PackEncoder,
): Promise<readonly Artifact[]> => {
  const writer = createPackWriter(pack.name, assets, artifacts);
  appendPackAssets(pack, writer);
  const sounds = new Map<string, Map<string, unknown>>(),
    encoded = new Map<string, Uint8Array>();
  for (const sound of [...pack.sounds].sort((a, b) => compareText(a.id, b.id))) {
    const { namespace, event, entries } = await appendSoundEventVariants(
      sound,
      writer,
      encoded,
      encoder,
    );
    const events = sounds.get(namespace) ?? new Map<string, unknown>();
    events.set(event, {
      replace: sound.replace,
      ...(sound.subtitle === null ? {} : { subtitle: sound.subtitle }),
      sounds: entries,
    });
    sounds.set(namespace, events);
  }
  for (const [namespace, events] of sounds)
    writer.addJson(`assets/${namespace}/sounds.json`, Object.fromEntries(events));
  return archivePack(pack.name, 'resource-pack', pack.archive, writer.files);
};
