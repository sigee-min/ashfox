import { BuildFailure } from '@ashfox/asset-build';
import {
  buildStructureDocument,
  encodeCanonicalPng,
  evaluateAssetQuality,
  rasterizeTexture,
  type AuditReport,
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
          palette: asset.product.structure.grid.states,
          customAssets: Object.keys(asset.product.structure.customModels),
        },
        audit: asset.product.structure.audit,
      }
    : {}),
});

export const inspect = (asset: Prepared): unknown => {
  const summary = asset.products ? { sourceHash: asset.revision, products: asset.products } : {};
  if (asset.document) return inspectDocument(asset, asset.document, summary);
  if (asset.sprite)
    return {
      ...summary,
      kind: 'sprite',
      revision: asset.revision,
      declarations: asset.declarations,
      receipt: asset.sprite.receipt,
      evidence: asset.sprite.evidence,
    };
  if (asset.product?.kind === 'sound')
    return {
      ...summary,
      kind: 'sound',
      revision: asset.revision,
      declarations: asset.declarations,
      variants: asset.product.sounds.map(({ wav, ...metadata }) => metadata),
    };
  throw new BuildFailure('observe.kind', 'Unsupported asset', 2);
};

const resolveTexture = (document: NonNullable<Prepared['document']>, selector: string) => {
  const texture =
    document.textures[selector] ??
    Object.values(document.textures).find((t) => t.name === selector);
  if (!texture) throw new BuildFailure('observe.texture', 'Unknown texture', 2);
  return Buffer.from(encodeCanonicalPng(rasterizeTexture(document, texture))).toString('base64');
};

const mediaPayload = (asset: Prepared, v: ViewOptions): unknown => {
  if (asset.document) {
    const activeDoc =
      asset.product?.kind === 'structure' && v.cutaway !== undefined
        ? buildStructureDocument(
            asset.product.structure.grid,
            asset.product.structure.customModels,
            { cutawayY: v.cutaway },
          )
        : asset.document;
    return v.texture ? { png: resolveTexture(activeDoc, v.texture) } : { document: activeDoc };
  }
  if (asset.sprite)
    return {
      png: Buffer.from(
        v.stage === 'final' ? asset.sprite.png : asset.sprite.stages[v.stage],
      ).toString('base64'),
    };
  const product = asset.product!;
  if (product.kind === 'sound') {
    const sound = selectSound(asset, v.variant),
      bytes = Buffer.from(sound.wav);
    const wave = Array.from({ length: v.width }, (_, x) => {
      let peak = 0;
      const start = Math.floor((x * sound.frames) / v.width),
        end = Math.floor(((x + 1) * sound.frames) / v.width);
      for (let i = start; i < end; i++)
        peak = Math.max(peak, Math.abs(bytes.readInt16LE(44 + i * 2) / 32768));
      return peak;
    });
    return { wave };
  }
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
  'sheet',
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
