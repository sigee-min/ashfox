import { freeze } from '../../../immutable';
import type { AssetId, TextureAsset } from '../../../model';
import type { TextureRaster } from '../../../model/texture';
import { sha256Digest } from '../../../provenance/digest';
import { encodeCanonicalPngSummary } from '../../../textures/textureRecipe/png';
import { rasterizeTextureSpec } from '../../../textures/textureRecipe/raster';
import type { SourceSpan } from '../../../project/source/contract';
import type { TypedSurface, TypedSurfaceContract } from './contract';
import { composeTextureCharts } from './texture/compose';
import type { TextureSceneContext } from './texture/ao';
import type { AssetTextureIssue, AssetTexturePlan, AssetTextureUsage } from './texture/contract';
import { prepareTexture, type PreparedTexture } from './texture/prepare';
import {
  createTextureReporter,
  expressionContextFor,
  surfacePayload,
  type TextureReporter,
} from './texture/report';

const textureIdFor = (key: string, name: string): string => {
  const digest = sha256Digest(key).slice(7, 19);
  return (name.length > 0 ? name : 'surface') + '_' + digest;
};

const symbolCopy = (surface: TypedSurface): TypedSurface['symbol'] =>
  freeze({
    modulePath: surface.symbol.modulePath,
    name: surface.symbol.name,
    kind: surface.symbol.kind,
    key: surface.symbol.key,
  });

const validUsage = (usage: AssetTextureUsage): boolean => {
  if (
    usage === null ||
    typeof usage !== 'object' ||
    typeof usage.chart !== 'string' ||
    usage.span === undefined ||
    usage.shape === null ||
    typeof usage.shape !== 'object'
  )
    return false;
  if (usage.shape.kind !== 'box' && usage.shape.kind !== 'flat') return false;
  const values = usage.shape.size;
  if (!Array.isArray(values)) return false;
  return (
    ((usage.shape.kind === 'box' && values.length === 3) ||
      (usage.shape.kind === 'flat' && values.length === 2)) &&
    values.every((value) => Number.isSafeInteger(value) && value > 0 && value <= 4096)
  );
};

const validateUsages = (
  usages: readonly AssetTextureUsage[],
  contract: TypedSurfaceContract,
  report: TextureReporter,
): boolean => {
  let valid = true;
  const known = new Set(Object.keys(contract.charts));
  for (const usage of usages) {
    if (!validUsage(usage)) {
      report.report(
        contract.span,
        'asset.texture.invalid-usage',
        'Texture geometry usage is malformed.',
      );
      valid = false;
    } else if (!known.has(usage.chart)) {
      report.report(
        usage.span,
        'asset.texture.unknown-chart',
        'Texture geometry usage names a chart outside the surface contract.',
      );
      valid = false;
    }
  }
  return valid;
};

const validateSurfaceBinding = (
  surface: TypedSurface,
  contract: TypedSurfaceContract,
  owner: SourceSpan,
  report: TextureReporter,
): boolean => {
  if (
    surface === null ||
    typeof surface !== 'object' ||
    contract === null ||
    typeof contract !== 'object' ||
    surface.contract.key !== contract.symbol.key
  ) {
    report.report(
      owner,
      'asset.texture.contract-mismatch',
      'Texture surface and contract identities must match.',
    );
    return false;
  }
  if (surface.material !== contract.material) {
    report.report(
      surface.span,
      'asset.texture.material-mismatch',
      'Texture surface material must match its surface contract.',
    );
    return false;
  }
  return true;
};

const buildTextureAsset = (
  surface: TypedSurface,
  textureId: string,
  width: number,
  height: number,
  prepared: PreparedTexture,
  composed: NonNullable<ReturnType<typeof composeTextureCharts>>,
): TextureAsset => {
  const rasterSpec: TextureRaster = freeze({
    background: prepared.background,
    backgroundAlpha: prepared.backgroundAlpha,
    canvasDetails: composed.details,
    alphaMasks: composed.masks,
  });
  const raster = rasterizeTextureSpec(width, height, rasterSpec);
  const { byteLength, contentHash } = encodeCanonicalPngSummary(raster);
  return freeze({
    id: textureId as AssetId,
    name: surface.symbol.name,
    width,
    height,
    source: freeze({
      bucket: 'inline',
      key: textureId + '.png',
      contentType: 'image/png',
      contentHash,
      byteLength,
    }),
    visible: true,
    sampling: 'nearest',
    colorSpace: 'srgb',
    renderMode: prepared.renderMode,
    renderSides: surface.material === 'double' ? 'double' : 'auto',
    atlasMode: 'preserve',
    raster: rasterSpec,
  });
};

const compileSurfacePlan = (
  surface: TypedSurface,
  contract: TypedSurfaceContract,
  usages: readonly AssetTextureUsage[],
  path: string,
  owner: SourceSpan,
  report: TextureReporter,
  scene?: TextureSceneContext,
): AssetTexturePlan | null => {
  if (!validateSurfaceBinding(surface, contract, owner, report)) return null;
  if (!Array.isArray(usages) || !validateUsages(usages, contract, report)) return null;
  const payload = surfacePayload(surface, report);
  if (payload === null) return null;
  const context = expressionContextFor(surface, contract, path, report);
  if (context === null) return null;
  const prepared = prepareTexture(payload, context, contract, usages, report);
  if (prepared === null) return null;
  const textureId = textureIdFor(surface.symbol.key, surface.symbol.name);
  const composed = composeTextureCharts(
    prepared,
    context,
    textureId,
    report,
    surface.symbol.key,
    scene,
  );
  if (composed === null) return null;
  const width = prepared.width;
  const height = prepared.height;
  if (width <= 0 || height <= 0 || report.bad) return null;
  const texture = buildTextureAsset(surface, textureId, width, height, prepared, composed);
  const telemetry = freeze({
    textureId: texture.id,
    tone: prepared.tone,
    defaultGrain: prepared.grain.algorithm,
    charts: composed.chartTelemetry,
  });
  return freeze({
    surfaceSymbol: symbolCopy(surface),
    texture,
    charts: composed.charts,
    telemetry,
  });
};

/** Materialize one surface after exact geometry usage dimensions are known. */
export const materializeAssetTexturePlan = (
  surface: TypedSurface,
  contract: TypedSurfaceContract,
  usages: readonly AssetTextureUsage[],
  path: string,
  issue: AssetTextureIssue,
  scene?: TextureSceneContext,
): AssetTexturePlan | null => {
  const owner = surface?.span ?? contract?.span;
  const report = createTextureReporter(path, owner, issue);
  try {
    return compileSurfacePlan(surface, contract, usages, path, owner, report, scene);
  } catch (error) {
    if (report.sinkFailed) throw error;
    if (!report.bad) {
      report.report(
        owner,
        'asset.texture.invalid',
        'Texture payload is malformed or exceeds the bounded materialization budget.',
      );
    }
    return null;
  }
};
