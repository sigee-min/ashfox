import type { TexturePbrMaterial } from '../../../../model/texture';
import type { ProgramExpr, ProgramProperty } from '../../../../project/program/syntax/contract';
import type { SourceSpan } from '../../../../project/source/contract';
import { encodeBase64Bytes } from '../../../../textures/textureRecipe/base64';
import { encodeCanonicalPng } from '../../../../textures/textureRecipe/png';
import { rasterizeTextureSpec } from '../../../../textures/textureRecipe/raster';
import type { TextureExpressionContext } from './expressions';
import type { PaintGrid } from './raster';
import type { TextureReporter } from './report';

export const DEFAULT_PBR_ROUGHNESS = 0.88;
export const DEFAULT_PBR_METALLIC = 0.0;
export const DEFAULT_PBR_ROUGHNESS_VARIATION = 0.0;

export interface ChartPbrSettings {
  readonly roughness: number;
  readonly metallic: number;
  readonly roughnessVariation: number;
}

export const DEFAULT_CHART_PBR: ChartPbrSettings = Object.freeze({
  roughness: DEFAULT_PBR_ROUGHNESS,
  metallic: DEFAULT_PBR_METALLIC,
  roughnessVariation: DEFAULT_PBR_ROUGHNESS_VARIATION,
});

export interface ChartPbrGridEntry {
  readonly origin: readonly [number, number];
  readonly width: number;
  readonly height: number;
  readonly pbr: ChartPbrSettings;
  readonly grid: PaintGrid;
}

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
    );
    return null;
  }
  return Math.round(num * 10_000) / 10_000;
};

/** Read optional roughness, metallic, and roughness_variation from a property map. */
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
  if (roughness === null || metallic === null || roughnessVariation === null) return null;
  return Object.freeze({ roughness, metallic, roughnessVariation });
};

const isUniformPbr = (
  entries: readonly ChartPbrGridEntry[],
  defaults: ChartPbrSettings,
): boolean => {
  if (entries.length === 0) return defaults.roughnessVariation === 0;
  const first = entries[0]!.pbr;
  return entries.every(
    (entry) =>
      entry.pbr.roughnessVariation === 0 &&
      entry.pbr.roughness === first.roughness &&
      entry.pbr.metallic === first.metallic,
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
  const { roughness, metallic, roughnessVariation } = entry.pbr;
  const metallicByte = clampByte(metallic);
  for (let y = 0; y < entry.height; y += 1) {
    for (let x = 0; x < entry.width; x += 1) {
      const src = y * entry.width + x;
      const dst = ((oy + y) * atlasWidth + (ox + x)) * 4;
      const aoStep = entry.grid.ao[src] ?? 0;
      const tone = entry.grid.tones[src] ?? 2;
      const edge = edgeProximity(x, y, entry.width, entry.height);
      const toneMod = (2 - tone) * 0.5;
      const aoMod = aoStep * 0.35;
      const edgeMod = -edge * 0.15;
      const varied = roughness + (toneMod + aoMod + edgeMod) * roughnessVariation;
      rgba[dst] = aoChannelByte(aoStep);
      rgba[dst + 1] = clampByte(varied);
      rgba[dst + 2] = metallicByte;
      rgba[dst + 3] = 255;
    }
  }
};

/** Encode linear RGBA bytes as a deterministic canonical PNG using TextureRaster details. */
export const encodeLinearRgbaPngBase64 = (
  width: number,
  height: number,
  rgba: Uint8Array,
): string => {
  const hex = (n: number): string => n.toString(16).padStart(2, '0');
  const details: {
    id: string;
    color: string;
    alpha: 255;
    x: number;
    y: number;
    width: number;
    height: number;
  }[] = [];
  for (let y = 0; y < height; y += 1) {
    let x = 0;
    while (x < width) {
      const p = (y * width + x) * 4;
      const r = rgba[p]!;
      const g = rgba[p + 1]!;
      const b = rgba[p + 2]!;
      let run = 1;
      while (x + run < width) {
        const np = (y * width + x + run) * 4;
        if (rgba[np] !== r || rgba[np + 1] !== g || rgba[np + 2] !== b) break;
        run += 1;
      }
      details.push({
        id: `p_${y}_${x}`,
        color: `#${hex(r)}${hex(g)}${hex(b)}`,
        alpha: 255,
        x,
        y,
        width: run,
        height: 1,
      });
      x += run;
    }
  }
  const raster = rasterizeTextureSpec(width, height, {
    background: '#ff0000',
    backgroundAlpha: 255,
    canvasDetails: details,
  });
  return encodeBase64Bytes(encodeCanonicalPng(raster));
};

/** Synthesize scalar PBR factors or a shared MetallicRoughness (+AO) PNG for an atlas. */
export const synthesizeAtlasPbr = (
  width: number,
  height: number,
  entries: readonly ChartPbrGridEntry[],
  defaults: ChartPbrSettings,
): TexturePbrMaterial | undefined => {
  if (isUniformPbr(entries, defaults)) {
    const sample = entries[0]?.pbr ?? defaults;
    if (sample.roughness === DEFAULT_PBR_ROUGHNESS && sample.metallic === DEFAULT_PBR_METALLIC) {
      return undefined;
    }
    return Object.freeze({ roughness: sample.roughness, metallic: sample.metallic });
  }
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
  return Object.freeze({
    roughness: defaults.roughness,
    metallic: defaults.metallic,
    metallicRoughnessPngBase64: encodeLinearRgbaPngBase64(width, height, rgba),
  });
};
