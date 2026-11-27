import type { TexturePbrMaterial } from '../../../../model/texture';
import type { ProgramExpr, ProgramProperty } from '../../../../project/program/syntax/contract';
import type { SourceSpan } from '../../../../project/source/contract';
import { docsHint } from '../../../../project/source/suggest';
import { srgbLuma } from '../../../../textures/color';
import { applyCurvaturePbr, type ChartCurvatureMask } from '../../../../textures/curvature';
import {
  grainHeightOffset,
  synthesizeNormalMapPngBase64,
  type NormalGrainKind,
  type NormalRegionBounds,
} from '../../../../textures/normalMap';
import { encodeBase64Bytes } from '../../../../textures/textureRecipe/base64';
import { encodeCanonicalPng } from '../../../../textures/textureRecipe/png';
import { createCanonicalTextureRaster } from '../../../../textures/textureRecipe/raster';
import type { GrainMode } from './contract';
import type { TextureExpressionContext } from './expressions';
import { toneColor, type PaintGrid, type PaintTone, type TextureRegion } from './raster';
import type { TextureReporter } from './report';

export const DEFAULT_PBR_ROUGHNESS = 0.88;
export const DEFAULT_PBR_METALLIC = 0.0;
export const DEFAULT_PBR_ROUGHNESS_VARIATION = 0.0;
export const DEFAULT_PBR_EDGE_WEAR = 0.0;

export interface ChartPbrSettings {
  readonly roughness: number;
  readonly metallic: number;
  readonly roughnessVariation: number;
  readonly normalStrength?: number;
  readonly edgeWear: number;
}

export const DEFAULT_CHART_PBR: ChartPbrSettings = Object.freeze({
  roughness: DEFAULT_PBR_ROUGHNESS,
  metallic: DEFAULT_PBR_METALLIC,
  roughnessVariation: DEFAULT_PBR_ROUGHNESS_VARIATION,
  edgeWear: DEFAULT_PBR_EDGE_WEAR,
});

export interface ChartPbrGridEntry {
  readonly origin: readonly [number, number];
  readonly width: number;
  readonly height: number;
  readonly pbr: ChartPbrSettings;
  readonly grid: PaintGrid;
  readonly regions: readonly TextureRegion[];
  readonly regionGrainModes: readonly GrainMode[];
  readonly baseRoleId: number;
  readonly seed: number;
  readonly hasRelief: boolean;
  readonly curvature?: ChartCurvatureMask;
}

const GRAIN_NORMAL_DEFAULT: Readonly<Record<GrainMode, number>> = {
  clustered: 0.3,
  wood: 0.26,
  brushed: 0.24,
  fur: 0.24,
  cloth: 0.22,
  soft: 0,
  none: 0,
};

const evalUnitlessRatio = (
  expr: ProgramExpr,
  context: TextureExpressionContext,
  span: SourceSpan,
  report: TextureReporter,
  name: string,
): number | null => {
  const val = context.evaluate(expr, 'ratio') ?? context.evaluate(expr);
  if (
    val === null ||
    val.kind !== 'number' ||
    val.value.denominator === 0n ||
    (val.value.unit !== 'ratio' && val.value.unit !== 'plain')
  ) {
    report.report(
      span,
      'asset.texture.invalid-pbr',
      `Property "${name}" requires a numeric ratio in range.`,
      docsHint('surface'),
    );
    return null;
  }
  return Number(val.value.numerator) / Number(val.value.denominator);
};

const readBoundedPbrScalar = (
  prop: ProgramProperty | undefined,
  fallback: number,
  max: number,
  name: string,
  context: TextureExpressionContext,
  report: TextureReporter,
): number | null => {
  if (prop === undefined) return fallback;
  const num = evalUnitlessRatio(prop.value, context, prop.value.span, report, name);
  if (num === null) return null;
  if (!Number.isFinite(num) || num < 0 || num > max) {
    report.report(
      prop.value.span,
      'asset.texture.invalid-pbr',
      `PBR property "${name}" must be between 0 and ${max}.`,
      docsHint('surface'),
    );
    return null;
  }
  return Math.round(num * 10_000) / 10_000;
};

/** Read optional PBR properties from a property map, inheriting defaults when omitted. */
export const readPbrProperties = (
  entries: ReadonlyMap<string, ProgramProperty>,
  defaults: ChartPbrSettings,
  context: TextureExpressionContext,
  report: TextureReporter,
): ChartPbrSettings | null => {
  const roughness = readBoundedPbrScalar(
    entries.get('roughness'),
    defaults.roughness,
    1,
    'roughness',
    context,
    report,
  );
  const metallic = readBoundedPbrScalar(
    entries.get('metallic'),
    defaults.metallic,
    1,
    'metallic',
    context,
    report,
  );
  const roughnessVariation = readBoundedPbrScalar(
    entries.get('roughness_variation'),
    defaults.roughnessVariation,
    0.3,
    'roughness_variation',
    context,
    report,
  );
  const edgeWear = readBoundedPbrScalar(
    entries.get('edge_wear'),
    defaults.edgeWear,
    1,
    'edge_wear',
    context,
    report,
  );
  const nsProp = entries.get('normal_strength');
  const normalStrength =
    nsProp === undefined
      ? defaults.normalStrength
      : readBoundedPbrScalar(nsProp, 0, 1, 'normal_strength', context, report);
  if (
    roughness === null ||
    metallic === null ||
    roughnessVariation === null ||
    edgeWear === null ||
    normalStrength === null
  ) {
    return null;
  }
  return Object.freeze({
    roughness,
    metallic,
    roughnessVariation,
    edgeWear,
    ...(normalStrength !== undefined ? { normalStrength } : {}),
  });
};

const hasCurvatureOrAo = (entry: ChartPbrGridEntry): boolean => {
  if (entry.pbr.edgeWear <= 0 || entry.curvature === undefined) return false;
  for (let i = 0; i < entry.curvature.convex.length; i += 1) {
    if (entry.curvature.convex[i]! > 0 || entry.curvature.concave[i]! > 0) return true;
  }
  return false;
};

const isUniformPbr = (
  entries: readonly ChartPbrGridEntry[],
  defaults: ChartPbrSettings,
): boolean => {
  if (entries.length === 0) return defaults.roughnessVariation === 0 && defaults.edgeWear === 0;
  const first = entries[0]!.pbr;
  return entries.every(
    (entry) =>
      entry.pbr.roughnessVariation === 0 &&
      entry.pbr.roughness === first.roughness &&
      entry.pbr.metallic === first.metallic &&
      !hasCurvatureOrAo(entry),
  );
};

const clampByte = (value: number): number => Math.max(0, Math.min(255, Math.round(value * 255)));

const aoChannelByte = (aoStep: number): number => (aoStep <= 0 ? 255 : aoStep === 1 ? 196 : 140);

const edgeProximity = (x: number, y: number, w: number, h: number): number =>
  x === 0 || y === 0 || x === w - 1 || y === h - 1 ? 1 : 0;

const paintChartPbrPixels = (
  rgba: Uint8Array,
  atlasWidth: number,
  entry: ChartPbrGridEntry,
): void => {
  const [ox, oy] = entry.origin;
  const { roughness, metallic, roughnessVariation, edgeWear } = entry.pbr;
  const metallicByte = clampByte(metallic);
  for (let y = 0; y < entry.height; y += 1) {
    for (let x = 0; x < entry.width; x += 1) {
      const src = y * entry.width + x;
      const dst = ((oy + y) * atlasWidth + (ox + x)) * 4;
      const aoStep = entry.grid.ao[src] ?? 0;
      const tone = entry.grid.tones[src] ?? 2;
      const mod =
        ((2 - tone) * 0.5 + aoStep * 0.35 - edgeProximity(x, y, entry.width, entry.height) * 0.15) *
        roughnessVariation;
      const varied = roughness + mod;
      const convex = entry.curvature?.convex[src] ?? 0;
      const concave = entry.curvature?.concave[src] ?? 0;
      const curved = applyCurvaturePbr(varied, aoChannelByte(aoStep), convex, concave, edgeWear);
      rgba[dst] = curved.aoByte;
      rgba[dst + 1] = clampByte(curved.roughness);
      rgba[dst + 2] = metallicByte;
      rgba[dst + 3] = 255;
    }
  }
};

/** Encode linear RGBA bytes as a deterministic canonical PNG. */
export const encodeLinearRgbaPngBase64 = (
  width: number,
  height: number,
  rgba: Uint8Array,
): string =>
  encodeBase64Bytes(encodeCanonicalPng(createCanonicalTextureRaster(width, height, rgba)));

const resolveRegionNormalStrength = (
  entry: ChartPbrGridEntry,
  grain: GrainMode,
  renderMode: 'default' | 'emissive',
): number => {
  if (entry.pbr.normalStrength !== undefined) return entry.pbr.normalStrength;
  if (renderMode === 'emissive') return 0;
  const grainDefault = GRAIN_NORMAL_DEFAULT[grain];
  if (grainDefault > 0) return grainDefault;
  if (!entry.hasRelief) return 0;
  return entry.pbr.metallic >= 0.5 ? 0.22 : 0.18;
};

const buildRoleLumaTable = (grid: PaintGrid): Float32Array => {
  const table = new Float32Array(Math.max(1, grid.roles.length) * 5);
  for (let roleId = 0; roleId < grid.roles.length; roleId += 1) {
    const role = grid.roles[roleId];
    for (let tone = 0; tone < 5; tone += 1) {
      const idx = roleId * 5 + tone;
      if (!role) {
        table[idx] = 0.5;
        continue;
      }
      const hex = toneColor(role, tone as PaintTone);
      const r = Number.parseInt(hex.slice(1, 3), 16);
      const g = Number.parseInt(hex.slice(3, 5), 16);
      const b = Number.parseInt(hex.slice(5, 7), 16);
      table[idx] = srgbLuma(r, g, b);
    }
  }
  return table;
};

const fillRegionHeights = (
  heights: Float32Array,
  atlasWidth: number,
  entry: ChartPbrGridEntry,
  region: TextureRegion,
  grain: GrainMode,
  baseLuma: number,
  lumaTable: Float32Array,
): void => {
  const [ox, oy] = entry.origin;
  const normalGrain: NormalGrainKind = grain === 'clustered' ? 'stone' : grain;
  for (let ly = 0; ly < region.height; ly += 1) {
    for (let lx = 0; lx < region.width; lx += 1) {
      const gx = region.x + lx;
      const gy = region.y + ly;
      const src = gy * entry.width + gx;
      const role = entry.grid.values[src] ?? 0;
      const tone = Math.max(0, Math.min(4, entry.grid.tones[src] ?? 0));
      const lumaDelta = role === 0 ? 0 : (lumaTable[role * 5 + tone] ?? 0.5) - baseLuma;
      const stampGain = entry.grid.fixed[src] !== 0 ? 1.35 : 0.85;
      const aoDrop = (entry.grid.ao[src] ?? 0) * 0.12;
      const grainOffset = grainHeightOffset(
        region.pointAt(lx, ly),
        entry.seed,
        normalGrain,
        lx,
        ly,
      );
      const h = Math.max(0, Math.min(1, 0.5 + lumaDelta * stampGain - aoDrop + grainOffset));
      heights[(oy + gy) * atlasWidth + (ox + gx)] = h;
    }
  }
};

const synthesizeAtlasNormal = (
  width: number,
  height: number,
  entries: readonly ChartPbrGridEntry[],
  renderMode: 'default' | 'emissive',
): string | undefined => {
  const regions: NormalRegionBounds[] = [];
  const heights = new Float32Array(width * height).fill(0.5);
  let active = false;
  for (const entry of entries) {
    const lumaTable = buildRoleLumaTable(entry.grid);
    const baseLuma = lumaTable[entry.baseRoleId * 5 + 2] ?? 0.5;
    for (let i = 0; i < entry.regions.length; i += 1) {
      const region = entry.regions[i]!;
      const grain = entry.regionGrainModes[i] ?? 'none';
      const strength = resolveRegionNormalStrength(entry, grain, renderMode);
      if (strength > 0) {
        active = true;
        fillRegionHeights(heights, width, entry, region, grain, baseLuma, lumaTable);
      }
      regions.push({
        x: entry.origin[0] + region.x,
        y: entry.origin[1] + region.y,
        width: region.width,
        height: region.height,
        strength,
      });
    }
  }
  return active ? synthesizeNormalMapPngBase64(width, height, heights, regions) : undefined;
};

const synthesizeMetallicRoughness = (
  width: number,
  height: number,
  entries: readonly ChartPbrGridEntry[],
  defaults: ChartPbrSettings,
): string | undefined => {
  if (isUniformPbr(entries, defaults)) return undefined;
  const rgba = new Uint8Array(width * height * 4);
  const bgR = clampByte(defaults.roughness);
  const bgM = clampByte(defaults.metallic);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 255;
    rgba[i + 1] = bgR;
    rgba[i + 2] = bgM;
    rgba[i + 3] = 255;
  }
  for (const entry of entries) paintChartPbrPixels(rgba, width, entry);
  return encodeLinearRgbaPngBase64(width, height, rgba);
};

/** Synthesize scalar PBR factors, optional MetallicRoughness+AO PNG, and optional Normal PNG. */
export const synthesizeAtlasPbr = (
  width: number,
  height: number,
  entries: readonly ChartPbrGridEntry[],
  defaults: ChartPbrSettings,
  renderMode: 'default' | 'emissive' = 'default',
): TexturePbrMaterial | undefined => {
  const sample = entries[0]?.pbr ?? defaults;
  const mrPng = synthesizeMetallicRoughness(width, height, entries, defaults);
  const normalPng = synthesizeAtlasNormal(width, height, entries, renderMode);
  const roughness = mrPng ? defaults.roughness : sample.roughness;
  const metallic = mrPng ? defaults.metallic : sample.metallic;
  if (
    !mrPng &&
    !normalPng &&
    roughness === DEFAULT_PBR_ROUGHNESS &&
    metallic === DEFAULT_PBR_METALLIC
  ) {
    return undefined;
  }
  return Object.freeze({
    roughness,
    metallic,
    ...(mrPng ? { metallicRoughnessPngBase64: mrPng } : {}),
    ...(normalPng ? { normalPngBase64: normalPng } : {}),
  });
};
