import type { TextureAsset } from '../model/texture';
import {
  rasterizeCanonicalTexture,
  type CanonicalRgbaBytes,
} from '../textures/textureRecipe/raster';
import { ramp } from './contract';
import type { AuditFaceBinding, AuditSceneGeometry } from './geometry';

export interface AuditRasterStats {
  readonly allFacesCovered: boolean;
  readonly missingFaceTargets: readonly string[];
  readonly isolatedNoiseRate: number;
  readonly noisyTextureIds: readonly string[];
  readonly lumP10: number;
  readonly lumP90: number;
  readonly lumRange: number;
  readonly upDownContrast: number;
  readonly uvDensityScore: number;
  readonly atlasUtilization: number;
}

interface RasterBuffer {
  readonly width: number;
  readonly height: number;
  readonly rgba: CanonicalRgbaBytes;
  readonly usedPixels: Uint8Array;
}

const srgbLuma = (r: number, g: number, b: number): number =>
  (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

const rasterizeTextureBuffer = (texture: TextureAsset): RasterBuffer | null => {
  if (texture.raster === undefined) return null;
  const result = rasterizeCanonicalTexture(texture.width, texture.height, {
    background: texture.raster.background,
    backgroundAlpha: texture.raster.backgroundAlpha,
    canvasDetails: [...texture.raster.canvasDetails],
    alphaMasks: [...(texture.raster.alphaMasks ?? [])],
  });
  return {
    width: result.width,
    height: result.height,
    rgba: result.rgba,
    usedPixels: new Uint8Array(result.width * result.height),
  };
};

const pixelAlpha = (buf: RasterBuffer, x: number, y: number): number =>
  buf.rgba.at((y * buf.width + x) * 4 + 3) ?? 0;

const pixelLuma = (buf: RasterBuffer, x: number, y: number): number => {
  const offset = (y * buf.width + x) * 4;
  return srgbLuma(
    buf.rgba.at(offset) ?? 0,
    buf.rgba.at(offset + 1) ?? 0,
    buf.rgba.at(offset + 2) ?? 0,
  );
};

const isIsolatedPixel = (
  buf: RasterBuffer,
  x: number,
  y: number,
): { readonly eligible: boolean; readonly isolated: boolean } => {
  if (pixelAlpha(buf, x, y) !== 255) return { eligible: false, isolated: false };
  const center = pixelLuma(buf, x, y);
  const dirs = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const;
  let neighbors = 0;
  let diffNeighbors = 0;
  for (const [dx, dy] of dirs) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= buf.width || ny >= buf.height) continue;
    if (pixelAlpha(buf, nx, ny) !== 255) continue;
    neighbors += 1;
    if (Math.abs(pixelLuma(buf, nx, ny) - center) > 0.14) diffNeighbors += 1;
  }
  if (neighbors < 2) return { eligible: false, isolated: false };
  return { eligible: true, isolated: diffNeighbors === neighbors };
};

const measureBufferNoise = (
  buf: RasterBuffer,
): { readonly eligible: number; readonly isolated: number } => {
  let eligible = 0;
  let isolated = 0;
  for (let y = 0; y < buf.height; y += 1) {
    for (let x = 0; x < buf.width; x += 1) {
      const check = isIsolatedPixel(buf, x, y);
      if (!check.eligible) continue;
      eligible += 1;
      if (check.isolated) isolated += 1;
    }
  }
  return { eligible, isolated };
};

const facePixelBounds = (
  binding: AuditFaceBinding,
  buf: RasterBuffer,
): {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly uvW: number;
  readonly uvH: number;
} | null => {
  const uv = binding.face.uv;
  if (!uv) return null;
  const xMin = Math.max(0, Math.floor(Math.min(uv[0], uv[2])));
  const xMax = Math.min(buf.width, Math.ceil(Math.max(uv[0], uv[2])));
  const yMin = Math.max(0, Math.floor(Math.min(uv[1], uv[3])));
  const yMax = Math.min(buf.height, Math.ceil(Math.max(uv[1], uv[3])));
  if (xMax <= xMin || yMax <= yMin) return null;
  return {
    x0: xMin,
    y0: yMin,
    x1: xMax,
    y1: yMax,
    uvW: Math.abs(uv[2] - uv[0]),
    uvH: Math.abs(uv[3] - uv[1]),
  };
};

interface FaceSampleAcc {
  readonly lumas: number[];
  topSum: number;
  topCount: number;
  botSum: number;
  botCount: number;
  densitySum: number;
  densityCount: number;
}

const sampleFacePixels = (
  binding: AuditFaceBinding,
  buf: RasterBuffer,
  acc: FaceSampleAcc,
): boolean => {
  const bounds = facePixelBounds(binding, buf);
  if (bounds === null) return false;
  let opaqueCount = 0;
  for (let y = bounds.y0; y < bounds.y1; y += 1) {
    for (let x = bounds.x0; x < bounds.x1; x += 1) {
      buf.usedPixels[y * buf.width + x] = 1;
      if (pixelAlpha(buf, x, y) !== 255) continue;
      opaqueCount += 1;
      const l = pixelLuma(buf, x, y);
      acc.lumas.push(l);
      if (binding.isTop) {
        acc.topSum += l;
        acc.topCount += 1;
      } else if (binding.isBottom) {
        acc.botSum += l;
        acc.botCount += 1;
      }
    }
  }
  const worldArea = Math.max(0.25, binding.worldWidth * binding.worldHeight);
  const uvArea = bounds.uvW * bounds.uvH;
  const ratio = uvArea / worldArea;
  const score = ratio >= 1 ? ramp(2.5 - ratio, 0, 1.5) : ramp(ratio, 0.25, 1);
  acc.densitySum += Math.max(0.2, score);
  acc.densityCount += 1;
  return opaqueCount > 0;
};

const quantile = (sorted: readonly number[], p: number): number => {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[index]!;
};

const buildTextureBuffers = (
  textures: Readonly<Record<string, TextureAsset>>,
): ReadonlyMap<string, RasterBuffer> => {
  const buffers = new Map<string, RasterBuffer>();
  for (const tex of Object.values(textures)) {
    const buf = rasterizeTextureBuffer(tex);
    if (buf !== null) buffers.set(tex.id, buf);
  }
  return buffers;
};

const aggregateBufferNoise = (
  buffers: ReadonlyMap<string, RasterBuffer>,
): {
  readonly isolatedNoiseRate: number;
  readonly noisyTextureIds: readonly string[];
  readonly atlasUtilization: number;
} => {
  let totalEligible = 0;
  let totalIsolated = 0;
  let totalAtlasPixels = 0;
  let usedAtlasPixels = 0;
  const noisyTextureIds: string[] = [];
  for (const [id, buf] of buffers.entries()) {
    const noise = measureBufferNoise(buf);
    totalEligible += noise.eligible;
    totalIsolated += noise.isolated;
    if (noise.eligible > 0 && noise.isolated / noise.eligible > 0.25) noisyTextureIds.push(id);
    totalAtlasPixels += buf.usedPixels.length;
    for (const v of buf.usedPixels) usedAtlasPixels += v;
  }
  return {
    isolatedNoiseRate: totalEligible > 0 ? totalIsolated / totalEligible : 0,
    noisyTextureIds: noisyTextureIds.sort(),
    atlasUtilization: totalAtlasPixels > 0 ? usedAtlasPixels / totalAtlasPixels : 0,
  };
};

export const analyzeRasterStats = (
  scene: AuditSceneGeometry,
  textures: Readonly<Record<string, TextureAsset>>,
): AuditRasterStats => {
  const buffers = buildTextureBuffers(textures);
  const missingFaceTargets: string[] = [];
  const acc: FaceSampleAcc = {
    lumas: [],
    topSum: 0,
    topCount: 0,
    botSum: 0,
    botCount: 0,
    densitySum: 0,
    densityCount: 0,
  };
  for (const binding of scene.enabledFaces) {
    const buf = binding.face.textureId === null ? undefined : buffers.get(binding.face.textureId);
    if (!buf || !sampleFacePixels(binding, buf, acc)) {
      missingFaceTargets.push(`${binding.nodeId}.${binding.direction}`);
    }
  }
  const noiseStats = aggregateBufferNoise(buffers);
  acc.lumas.sort((a, b) => a - b);
  const lumP10 = quantile(acc.lumas, 0.1);
  const lumP90 = quantile(acc.lumas, 0.9);
  const upMean = acc.topCount > 0 ? acc.topSum / acc.topCount : 0;
  const downMean = acc.botCount > 0 ? acc.botSum / acc.botCount : 0;
  return {
    allFacesCovered: scene.enabledFaces.length > 0 && missingFaceTargets.length === 0,
    missingFaceTargets: missingFaceTargets.slice(0, 8),
    ...noiseStats,
    lumP10,
    lumP90,
    lumRange: Math.max(0, lumP90 - lumP10),
    upDownContrast: acc.topCount > 0 && acc.botCount > 0 ? upMean - downMean : 0,
    uvDensityScore: acc.densityCount > 0 ? acc.densitySum / acc.densityCount : 0,
  };
};
