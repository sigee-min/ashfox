import { zipSync } from 'fflate';
import { BuildFailure } from '@ashfox/asset-build';
import {
  encodeCanonicalPng,
  evaluateAssetQuality,
  formatDeliveryGateFailure,
  rasterizeTexture,
  measureSceneGeometry,
  inspectNodeSurface,
  openAssetProject,
  exportProductionProjectResolved,
  type AuditOptions,
  type AuditReport,
} from '@ashfox/engine-core';
import { DEFAULT_VIEW, type Prepared, type Media, type ViewOptions } from './contract';
import { ChromeRenderer } from './chrome';

export const renderCapabilities = {
  format: 'ashfox-render',
  version: 1,
  inputs: ['ashfox-file', 'png-file', 'memory-source-graph', 'base64-png'],
  media: ['image/png', 'image/gif', 'audio/wav', 'model/gltf-binary', 'application/zip'],
  formats: ['glb', 'gltf', 'java_block', 'geckolib5', 'bedrock', 'png', 'wav'],
  viewDefaults: DEFAULT_VIEW,
  limits: {
    inputBytes: 16 * 1024 * 1024,
    compileSeconds: 120,
    renderSeconds: 120,
    mediaBytes: 32 * 1024 * 1024,
  },
};

const auditAsset = (asset: Prepared, options: AuditOptions = {}): AuditReport => {
  if (asset.product?.kind !== 'model')
    throw new BuildFailure('observe.kind', 'audit requires a model asset', 2);
  return evaluateAssetQuality(
    { model: asset.product.model, telemetry: asset.product.telemetry },
    options,
  );
};

const inspectDocument = (
  asset: Prepared,
  d: NonNullable<Prepared['document']>,
  summary: Record<string, unknown>,
  nodeId: string | undefined,
  auditOptions?: AuditOptions,
): unknown => {
  if (nodeId) {
    if (!d.scene.nodes[nodeId])
      throw new BuildFailure('observe.node', 'Unknown node: ' + nodeId, 2);
    return {
      node: d.scene.nodes[nodeId],
      measurement: measureSceneGeometry(d, {
        nodeId,
        scope: 'subtree',
        groundY: 0,
        tolerance: 0.001,
      }),
      surface: inspectNodeSurface(d, nodeId),
    };
  }
  return {
    ...summary,
    kind: asset.kind,
    revision: asset.revision,
    nodes: Object.values(d.scene.nodes),
    textures: Object.values(d.textures).map((t) => ({
      id: t.id,
      name: t.name,
      width: t.width,
      height: t.height,
    })),
    animations: Object.values(d.animations),
    settings: d.settings,
    ...(asset.product?.kind === 'model' ? { audit: auditAsset(asset, auditOptions) } : {}),
  };
};

export const inspect = (asset: Prepared, v: ViewOptions, auditOptions?: AuditOptions): unknown => {
  if (
    auditOptions &&
    (auditOptions.profile !== undefined || auditOptions.threshold !== undefined) &&
    asset.product?.kind !== 'model'
  )
    throw new BuildFailure('observe.kind', 'profile and threshold require a model asset', 2);
  const summary = asset.products ? { sourceHash: asset.revision, products: asset.products } : {};
  if (asset.document) return inspectDocument(asset, asset.document, summary, v.node, auditOptions);
  if (asset.sprite)
    return {
      ...summary,
      kind: 'sprite',
      revision: asset.revision,
      receipt: asset.sprite.receipt,
      evidence: asset.sprite.evidence,
    };
  if (asset.product?.kind === 'sound')
    return {
      ...summary,
      kind: 'sound',
      revision: asset.revision,
      variants: asset.product.sounds.map(({ wav, ...metadata }) => metadata),
    };
  const bytes = Buffer.from(asset.png!, 'base64');
  return {
    kind: 'png',
    revision: asset.revision,
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
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
    return v.texture
      ? { png: resolveTexture(asset.document, v.texture) }
      : { document: asset.document };
  }
  if (asset.png) return { png: asset.png };
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

const assertRenderOptions = (asset: Prepared, v: ViewOptions, gif: boolean): void => {
  if (asset.kind !== 'model') {
    for (const key of MODEL_ONLY_VIEW_KEYS)
      if (v[key] !== DEFAULT_VIEW[key])
        throw new BuildFailure('observe.option', key + ' requires a model', 2);
  }
  if (gif && v.sheet !== undefined)
    throw new BuildFailure('observe.option', 'sheet requires still render, not --gif', 2);
  if (asset.kind !== 'sprite' && v.stage !== 'final')
    throw new BuildFailure('observe.option', 'stage requires a sprite source', 2);
  if (asset.kind !== 'sound' && v.variant !== undefined)
    throw new BuildFailure('observe.option', 'variant requires a sound source', 2);
  if (v.format || v.namespace || v.modelPath)
    throw new BuildFailure('observe.option', 'Export format options do not apply to render', 2);
};

export const renderMedia = async (
  asset: Prepared,
  v: ViewOptions,
  gif: boolean,
  renderer: ChromeRenderer,
  signal: AbortSignal,
): Promise<Media> => {
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

const assertExportGate = (asset: Prepared): void => {
  if (asset.product?.kind !== 'model') throw new BuildFailure('observe.kind', 'No model', 2);
  const hasProfile = asset.product.model.profile !== undefined;
  const audit = auditAsset(asset);
  if (!hasProfile) {
    throw new BuildFailure(
      'quality.profile-required',
      formatDeliveryGateFailure(asset.product.entry.entryName, false, audit),
      3,
    );
  }
  if (!audit.passed) {
    throw new BuildFailure(
      'quality.gate',
      formatDeliveryGateFailure(asset.product.entry.entryName, true, audit),
      3,
    );
  }
};

const packageModelBundle = (
  bundle: Awaited<ReturnType<typeof exportProductionProjectResolved>>,
  format: string,
): Media => {
  if (format === 'glb') {
    const file = bundle.files.find((f) => f.kind === 'binary' && f.path.endsWith('.glb'));
    if (!file || file.kind !== 'binary') throw new BuildFailure('observe.export', 'Missing GLB', 3);
    return { mime: 'model/gltf-binary', bytes: file.data };
  }
  const files: Record<string, Uint8Array> = {};
  for (const file of [...bundle.files].sort((a, b) => a.path.localeCompare(b.path))) {
    if (file.kind === 'blob-copy') throw new BuildFailure('observe.export', 'Unresolved file', 3);
    files[file.path] = file.kind === 'binary' ? file.data : Buffer.from(JSON.stringify(file.data));
  }
  return {
    mime: 'application/zip',
    bytes: zipSync(files, { level: 0, mtime: new Date(1980, 0, 1) }),
  };
};

const exportModelProduct = async (
  asset: Prepared,
  modelProduct: Extract<NonNullable<Prepared['product']>, { readonly kind: 'model' }>,
  v: ViewOptions,
): Promise<Media> => {
  const opened = openAssetProject({
    workspace: modelProduct.workspace,
    entry: modelProduct.entry,
    identity: { id: 'observe', revision: asset.revision, createdAt: '2000-01-01T00:00:00.000Z' },
  });
  if (!opened.ok) throw new BuildFailure('observe.model', 'Cannot open model');
  const textures = new Map(
    Object.values(opened.project.document.textures).map((t) => [
      t.source.key,
      {
        bytes: encodeCanonicalPng(rasterizeTexture(opened.project.document, t)),
        contentType: 'image/png',
      },
    ]),
  );
  const format = v.format ?? 'glb';
  if (format === 'png' || format === 'wav')
    throw new BuildFailure('observe.format', 'Expected model format', 2);
  const adapter =
    format === 'glb' || format === 'gltf'
      ? { target: format, modelPath: v.modelPath ?? modelProduct.entry.entryName }
      : {
          target: format,
          namespace: v.namespace ?? '',
          modelPath: v.modelPath ?? modelProduct.entry.entryName,
        };
  const bundle = await exportProductionProjectResolved(opened.project, adapter, {
    encoding: 'portable',
    resolveBlob: async (ref) => textures.get(ref.key) ?? null,
  });
  return packageModelBundle(bundle, format);
};

export const exportAsset = async (asset: Prepared, v: ViewOptions): Promise<Media> => {
  const kind = asset.kind === 'png' ? 'sprite' : asset.kind;
  const allowed = {
    sprite: ['png'],
    sound: ['wav'],
    model: ['glb', 'gltf', 'java_block', 'geckolib5', 'bedrock'],
  }[kind];
  if (v.format && !allowed.includes(v.format))
    throw new BuildFailure('observe.format', 'Format does not match asset kind', 2);
  if (asset.png) return { mime: 'image/png', bytes: Buffer.from(asset.png, 'base64') };
  if (asset.sprite) return { mime: 'image/png', bytes: asset.sprite.png };
  if (asset.product?.kind === 'sound')
    return { mime: 'audio/wav', bytes: selectSound(asset, v.variant).wav };
  assertExportGate(asset);
  if (asset.product?.kind !== 'model') throw new BuildFailure('observe.kind', 'No model', 2);
  return exportModelProduct(asset, asset.product, v);
};
