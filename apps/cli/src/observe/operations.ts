import { evaluateSoundQuality, renderSoundInspectSheet } from '@ashfox/audio-core';
import { BuildFailure } from '@ashfox/asset-build';
import {
  buildStructureBakedMesh,
  collectStructureCutBands,
  encodeCanonicalPng,
  encodeRgbaBufferPng,
  evaluateAssetQuality,
  evaluateSpriteQuality,
  rasterizeTexture,
  spriteInspectSheetPng,
  type AuditReport,
  type CanonicalTextureRaster,
  type DeclaredPreviewSpec,
} from '@ashfox/engine-core';
import { DEFAULT_VIEW, type Prepared, type Media, type ViewOptions } from './contract';
import { ChromeRenderer } from './chrome';

export const renderCapabilities = {
  format: 'ashfox-render',
  version: 1,
  inputs: ['ashfox-file', 'memory-source-graph'],
  media: ['image/png', 'image/gif'],
  viewDefaults: DEFAULT_VIEW,
  limits: {
    inputBytes: 16 * 1024 * 1024,
    compileSeconds: 120,
    renderSeconds: 120,
    mediaBytes: 32 * 1024 * 1024,
  },
};

const auditAsset = (asset: Prepared): AuditReport => {
  if (asset.product?.kind !== 'model')
    throw new BuildFailure('observe.kind', 'audit requires a model asset', 2);
  return evaluateAssetQuality({
    model: asset.product.model,
    telemetry: asset.product.telemetry,
  });
};

const inspectDocument = (
  asset: Prepared,
  d: NonNullable<Prepared['document']>,
  summary: Record<string, unknown>,
): unknown => ({
  ...summary,
  kind: asset.kind,
  revision: asset.revision,
  declarations: asset.declarations,
  nodes: Object.values(d.scene.nodes),
  textures: Object.values(d.textures).map((t) => ({
    id: t.id,
    name: t.name,
    width: t.width,
    height: t.height,
  })),
  animations: Object.values(d.animations),
  settings: d.settings,
  ...(asset.product?.kind === 'model' ? { audit: auditAsset(asset) } : {}),
  ...(asset.product?.kind === 'structure'
    ? {
        structure: {
          size: asset.product.structure.grid.size,
          density: asset.product.structure.grid.density,
          palette: asset.product.structure.grid.states,
          customAssets: Object.keys(asset.product.structure.customModels),
          floors: asset.product.structure.grid.floors,
          rooms: asset.product.structure.grid.rooms,
          openings: asset.product.structure.grid.openings,
          sockets: asset.product.structure.grid.sockets,
          semanticStats: asset.product.structure.grid.semanticStats,
          playableMeta: {
            zoneCount: asset.product.structure.playableMeta.zones.length,
            lightCount: asset.product.structure.playableMeta.lights.length,
            interactableCount: asset.product.structure.playableMeta.interactables.length,
          },
        },
        audit: asset.product.structure.audit,
      }
    : {}),
});

const toSpriteRaster = (s: NonNullable<Prepared['sprite']>): CanonicalTextureRaster => ({
  width: s.receipt.width,
  height: s.receipt.height,
  rgba: {
    length: s.rgba.length,
    at: (i: number) => s.rgba[i],
    copy: () => new Uint8Array(s.rgba),
    [Symbol.iterator]: () => s.rgba[Symbol.iterator](),
  },
});

export const inspect = (asset: Prepared): unknown => {
  const summary = asset.products ? { sourceHash: asset.revision, products: asset.products } : {};
  if (asset.document) return inspectDocument(asset, asset.document, summary);
  if (asset.sprite) {
    const audit = evaluateSpriteQuality({
      profile: asset.sprite.profile,
      raster: toSpriteRaster(asset.sprite),
      telemetry: asset.sprite.telemetry,
    });
    return {
      ...summary,
      kind: 'sprite',
      revision: asset.revision,
      declarations: asset.declarations,
      receipt: asset.sprite.receipt,
      evidence: asset.sprite.evidence,
      audit,
    };
  }
  if (asset.product?.kind === 'sound') {
    const audit = evaluateSoundQuality(asset.product.sounds);
    return {
      ...summary,
      kind: 'sound',
      revision: asset.revision,
      declarations: asset.declarations,
      variants: asset.product.sounds.map(({ wav, ...metadata }) => metadata),
      audit,
    };
  }
  throw new BuildFailure('observe.kind', 'Unsupported asset', 2);
};

const resolveTexture = (document: NonNullable<Prepared['document']>, selector: string) => {
  const texture =
    document.textures[selector] ??
    Object.values(document.textures).find((t) => t.name === selector);
  if (!texture) throw new BuildFailure('observe.texture', 'Unknown texture', 2);
  return Buffer.from(encodeCanonicalPng(rasterizeTexture(document, texture))).toString('base64');
};

const binPeak = (bytes: Buffer, channels: number, start: number, end: number): number => {
  let peak = 0;
  for (let i = start; i < end; i++) {
    for (let ch = 0; ch < channels; ch++) {
      peak = Math.max(peak, Math.abs(bytes.readInt16LE(44 + (i * channels + ch) * 2) / 32768));
    }
  }
  return peak;
};

const soundWavePayload = (asset: Prepared, v: ViewOptions): { readonly wave: number[] } => {
  const sound = selectSound(asset, v.variant);
  const bytes = Buffer.from(sound.wav);
  const wave = Array.from({ length: v.width }, (_, x) => {
    const start = Math.floor((x * sound.frames) / v.width);
    const end = Math.floor(((x + 1) * sound.frames) / v.width);
    return binPeak(bytes, sound.channels, start, end);
  });
  return { wave };
};

const buildStructureCutSlices = (
  structure: Extract<NonNullable<Prepared['product']>, { kind: 'structure' }>['structure'],
) =>
  collectStructureCutBands(structure.grid.floors, structure.grid.size[1]).map((entry) => ({
    ...entry,
    bakedMesh: buildStructureBakedMesh(structure.grid, structure.lighting, structure.customModels, {
      cutawayY: entry.cutY,
    }),
  }));

const structurePayload = (
  structure: Extract<NonNullable<Prepared['product']>, { kind: 'structure' }>['structure'],
  v: ViewOptions,
) => {
  const bakedMesh =
    v.cutaway !== undefined
      ? buildStructureBakedMesh(structure.grid, structure.lighting, structure.customModels, {
          cutawayY: v.cutaway,
        })
      : structure.bakedMesh;
  return {
    structure: {
      id: structure.id,
      size: structure.grid.size,
      bakedMesh,
      customModels: structure.customModels,
      playableMeta: structure.playableMeta,
      floors: structure.grid.floors,
      rooms: structure.grid.rooms,
      ...(v.sheet === 'cutaway' ? { cutSlices: buildStructureCutSlices(structure) } : {}),
    },
  };
};

const mediaPayload = (asset: Prepared, v: ViewOptions): unknown => {
  if (asset.document) {
    if (v.texture) return { png: resolveTexture(asset.document, v.texture) };
    if (asset.product?.kind === 'structure') {
      return structurePayload(asset.product.structure, v);
    }
    return { document: asset.document };
  }
  if (asset.sprite)
    return {
      png: Buffer.from(
        v.stage === 'final' ? asset.sprite.png : asset.sprite.stages[v.stage],
      ).toString('base64'),
    };
  if (asset.product?.kind === 'sound') return soundWavePayload(asset, v);
  throw new BuildFailure('observe.kind', 'Unsupported asset', 2);
};

const selectSound = (asset: Prepared, variant?: string) => {
  if (asset.product?.kind !== 'sound')
    throw new BuildFailure('observe.kind', 'Expected a sound', 2);
  const sound = variant
    ? asset.product.sounds.find((s) => s.variant === variant)
    : asset.product.sounds[0];
  if (!sound) throw new BuildFailure('observe.variant', 'Unknown variant: ' + variant, 2);
  return sound;
};

const MODEL_ONLY_VIEW_KEYS = [
  'camera',
  'azimuth',
  'elevation',
  'zoom',
  'clip',
  'time',
  'wireframe',
  'skeleton',
  'textures',
  'node',
  'texture',
] as const;

const assertNonModelViewDefaults = (v: ViewOptions): void => {
  for (const key of MODEL_ONLY_VIEW_KEYS)
    if (v[key] !== DEFAULT_VIEW[key])
      throw new BuildFailure('observe.option', key + ' requires a model or structure', 2);
};

const assertRenderOptions = (asset: Prepared, v: ViewOptions, gif: boolean): void => {
  if (asset.kind !== 'model' && asset.kind !== 'structure') assertNonModelViewDefaults(v);
  if (v.cutaway !== undefined && asset.kind !== 'structure')
    throw new BuildFailure('observe.option', 'cutaway requires a structure source', 2);
  if (v.sheet === 'turnaround' && asset.kind !== 'model' && asset.kind !== 'structure')
    throw new BuildFailure('observe.option', 'sheet turnaround requires a model or structure', 2);
  if (
    (v.sheet === 'exterior' || v.sheet === 'cutaway' || v.sheet === 'interior') &&
    asset.kind !== 'structure'
  )
    throw new BuildFailure('observe.option', `sheet ${v.sheet} requires a structure source`, 2);
  if (gif && v.sheet !== undefined)
    throw new BuildFailure('observe.option', 'sheet requires still render, not gif', 2);
  if (asset.kind !== 'sprite' && v.stage !== 'final')
    throw new BuildFailure('observe.option', 'stage requires a sprite source', 2);
  if (asset.kind !== 'sound' && v.variant !== undefined)
    throw new BuildFailure('observe.option', 'variant requires a sound source', 2);
};

const buildPreviewView = (spec?: DeclaredPreviewSpec): ViewOptions => {
  if (!spec) return DEFAULT_VIEW;
  const { name: _name, kind: _kind, ...fields } = spec;
  return { ...DEFAULT_VIEW, ...fields };
};

export const renderMedia = async (
  asset: Prepared,
  viewName: string,
  renderer: ChromeRenderer,
  signal: AbortSignal,
): Promise<Media> => {
  const spec = asset.declarations.previews.find((p) => p.name === viewName);
  if (!spec && viewName !== 'default') {
    throw new BuildFailure('observe.view', 'Unknown preview view: ' + viewName, 2);
  }
  const gif = spec?.kind === 'gif';
  const v = buildPreviewView(spec);
  assertRenderOptions(asset, v, gif);
  if (v.sheet === 'inspect' && asset.sprite) {
    const raster = toSpriteRaster(asset.sprite);
    const audit = evaluateSpriteQuality({
      profile: asset.sprite.profile,
      raster,
      telemetry: asset.sprite.telemetry,
    });
    return {
      mime: 'image/png',
      bytes: spriteInspectSheetPng({ profile: asset.sprite.profile, raster }, audit),
    };
  }
  if (v.sheet === 'inspect' && asset.product?.kind === 'sound') {
    const sheet = renderSoundInspectSheet(asset.product.sounds);
    return { mime: 'image/png', bytes: encodeRgbaBufferPng(sheet.rgba, sheet.width, sheet.height) };
  }
  const abort = () => {
    void renderer.close();
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) throw new BuildFailure('observe.cancelled', 'Cancelled', 130);
    await renderer.start();
    await renderer.evaluate('AshfoxObserver.load(' + JSON.stringify(mediaPayload(asset, v)) + ')');
    const reply = (await renderer.evaluate(
      'AshfoxObserver.capture(' + JSON.stringify(v) + ',' + gif + ')',
    )) as { mime: string; data: string };
    if (signal.aborted) throw new BuildFailure('observe.cancelled', 'Cancelled', 130);
    const bytes = Buffer.from(reply.data, 'base64');
    if (bytes.length > 32 * 1024 * 1024)
      throw new BuildFailure('observe.budget', 'Media exceeds 32 MiB', 3);
    return { mime: reply.mime, bytes };
  } finally {
    signal.removeEventListener('abort', abort);
  }
};
