import type { TextureAsset } from '../model/texture';
import { srgbLuma } from '../textures/color';
import { rasterizeTextureSpec } from '../textures/textureRecipe/raster';
import {
  createColorStatsAcc,
  finalizeColorStats,
  recordColorPixel,
  type ColorStatsAcc,
} from './colorStats';
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
  readonly meanPpu: number;
  readonly ppuConsistency: number;
  readonly highFreqClutterRate: number;
  readonly checkerRate: number;
  readonly darkCrushRate: number;
  readonly paletteHarmonyScore: number;
  readonly atlasUtilization: number;
}

interface RasterBuffer {
  readonly width: number;
  readonly height: number;
  readonly isEmissive: boolean;
  readonly rgba: Uint8Array;
  readonly lumas: Float64Array;
  readonly usedPixels: Uint8Array;
}

const NEIGHBOR_DIRS: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

const pixelIndex = (width: number, x: number, y: number): number => y * width + x;

const rasterizeTextureBuffer = (texture: TextureAsset): RasterBuffer | null => {
  if (texture.raster === undefined) return null;
  const result = rasterizeTextureSpec(texture.width, texture.height, texture.raster);
  const rgba = result.rgba.copy();
  const total = result.width * result.height;
  const lumas = new Float64Array(total);
  for (let i = 0, o = 0; i < total; i += 1, o += 4) {
    if (rgba[o + 3] === 255) {
      lumas[i] = srgbLuma(rgba[o]!, rgba[o + 1]!, rgba[o + 2]!);
    }
  }
  return {
    width: result.width,
    height: result.height,
    isEmissive: texture.renderMode === 'emissive',
    rgba,
    lumas,
    usedPixels: new Uint8Array(total),
  };
};

/** Return 0 = ineligible, 1 = eligible non-isolated, 2 = eligible isolated. */
const classifyIsolatedPixel = (buf: RasterBuffer, x: number, y: number): 0 | 1 | 2 => {
  const idx = pixelIndex(buf.width, x, y);
  if (buf.rgba[idx * 4 + 3] !== 255) return 0;
  const center = buf.lumas[idx]!;
  let neighbors = 0;
  let diffNeighbors = 0;
  for (let i = 0; i < 4; i += 1) {
    const dir = NEIGHBOR_DIRS[i]!;
    const nx = x + dir[0];
    const ny = y + dir[1];
    if (nx < 0 || ny < 0 || nx >= buf.width || ny >= buf.height) continue;
    const nIdx = pixelIndex(buf.width, nx, ny);
    if (buf.rgba[nIdx * 4 + 3] !== 255) continue;
    neighbors += 1;
    if (Math.abs(buf.lumas[nIdx]! - center) > 0.14) diffNeighbors += 1;
  }
  if (neighbors < 2) return 0;
  return diffNeighbors === neighbors ? 2 : 1;
};

const measureBufferNoise = (
  buf: RasterBuffer,
): { readonly eligible: number; readonly isolated: number } => {
  let eligible = 0;
  let isolated = 0;
  for (let y = 0; y < buf.height; y += 1) {
    for (let x = 0; x < buf.width; x += 1) {
      const code = classifyIsolatedPixel(buf, x, y);
      if (code === 0) continue;
      eligible += 1;
      if (code === 2) isolated += 1;
    }
  }
  return { eligible, isolated };
};

interface FaceBounds {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly uvW: number;
  readonly uvH: number;
}

const facePixelBounds = (binding: AuditFaceBinding, buf: RasterBuffer): FaceBounds | null => {
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
  readonly ppuSamples: Array<{ readonly ppu: number; readonly weight: number }>;
  adjPairs: number;
  harshPairs: number;
  checkerEligible: number;
  checkerHits: number;
  readonly color: ColorStatsAcc;
}

const checkPairClutter = (
  buf: RasterBuffer,
  lCenter: number,
  nIdx: number,
  acc: FaceSampleAcc,
): void => {
  if (buf.rgba[nIdx * 4 + 3] !== 255) return;
  acc.adjPairs += 1;
  if (Math.abs(lCenter - buf.lumas[nIdx]!) > 0.09) acc.harshPairs += 1;
};

const checkCheckerCenter = (
  buf: RasterBuffer,
  lCenter: number,
  idx: number,
  acc: FaceSampleAcc,
): void => {
  const w = buf.width;
  const rgba = buf.rgba;
  if (
    rgba[(idx - 1) * 4 + 3] !== 255 ||
    rgba[(idx + 1) * 4 + 3] !== 255 ||
    rgba[(idx - w) * 4 + 3] !== 255 ||
    rgba[(idx + w) * 4 + 3] !== 255
  ) {
    return;
  }
  acc.checkerEligible += 1;
  const lumas = buf.lumas;
  const dL = lCenter - lumas[idx - 1]!;
  const dR = lCenter - lumas[idx + 1]!;
  const dU = lCenter - lumas[idx - w]!;
  const dD = lCenter - lumas[idx + w]!;
  if (dL * dR > 0.015 && dU * dD > 0.015) acc.checkerHits += 1;
};

const recordFaceTexel = (
  binding: AuditFaceBinding,
  buf: RasterBuffer,
  bounds: FaceBounds,
  x: number,
  y: number,
  acc: FaceSampleAcc,
): boolean => {
  const idx = pixelIndex(buf.width, x, y);
  buf.usedPixels[idx] = 1;
  const offset = idx * 4;
  if (buf.rgba[offset + 3] !== 255) return false;
  const r = buf.rgba[offset]!;
  const g = buf.rgba[offset + 1]!;
  const b = buf.rgba[offset + 2]!;
  recordColorPixel(acc.color, r, g, b, buf.isEmissive);
  const l = buf.lumas[idx]!;
  acc.lumas.push(l);
  if (binding.isTop) {
    acc.topSum += l;
    acc.topCount += 1;
  } else if (binding.isBottom) {
    acc.botSum += l;
    acc.botCount += 1;
  }
  if (x + 1 < bounds.x1) checkPairClutter(buf, l, idx + 1, acc);
  if (y + 1 < bounds.y1) checkPairClutter(buf, l, idx + buf.width, acc);
  if (x > bounds.x0 && x + 1 < bounds.x1 && y > bounds.y0 && y + 1 < bounds.y1) {
    checkCheckerCenter(buf, l, idx, acc);
  }
  return true;
};

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
      if (recordFaceTexel(binding, buf, bounds, x, y, acc)) opaqueCount += 1;
    }
  }
  const worldArea = Math.max(0.25, binding.worldWidth * binding.worldHeight);
  const uvArea = bounds.uvW * bounds.uvH;
  acc.ppuSamples.push({ ppu: Math.sqrt(uvArea / worldArea), weight: worldArea });
  return opaqueCount > 0;
};

const finalizePpuStats = (
  samples: readonly { readonly ppu: number; readonly weight: number }[],
): { readonly meanPpu: number; readonly ppuConsistency: number } => {
  if (samples.length === 0) return { meanPpu: 0, ppuConsistency: 0 };
  const totalWeight = samples.reduce((s, item) => s + item.weight, 0);
  const meanPpu =
    totalWeight > 0 ? samples.reduce((s, item) => s + item.ppu * item.weight, 0) / totalWeight : 0;
  const variance =
    totalWeight > 0
      ? samples.reduce((s, item) => s + item.weight * (item.ppu - meanPpu) ** 2, 0) / totalWeight
      : 0;
  const relStd = meanPpu > 0 ? Math.sqrt(variance) / meanPpu : 0;
  return { meanPpu, ppuConsistency: 1 - ramp(relStd, 0.1, 0.55) };
};

const quickselect = (arr: number[], k: number, leftInit: number, rightInit: number): number => {
  let left = leftInit;
  let right = rightInit;
  while (left < right) {
    const mid = (left + right) >>> 1;
    const pivot = arr[mid]!;
    let lt = left;
    let i = left;
    let gt = right;
    while (i <= gt) {
      const value = arr[i]!;
      if (value < pivot) {
        arr[i] = arr[lt]!;
        arr[lt] = value;
        lt += 1;
        i += 1;
      } else if (value > pivot) {
        arr[i] = arr[gt]!;
        arr[gt] = value;
        gt -= 1;
      } else {
        i += 1;
      }
    }
    if (k < lt) right = lt - 1;
    else if (k > gt) left = gt + 1;
    else return arr[k]!;
  }
  return arr[k]!;
};

const quantileIndex = (length: number, p: number): number =>
  Math.min(length - 1, Math.max(0, Math.floor((length - 1) * p)));

const lumaPercentiles = (lumas: number[]): readonly [number, number] => {
  if (lumas.length === 0) return [0, 0];
  const k10 = quantileIndex(lumas.length, 0.1);
  const k90 = quantileIndex(lumas.length, 0.9);
  const p10 = quickselect(lumas, k10, 0, lumas.length - 1);
  const p90 = quickselect(lumas, k90, k10, lumas.length - 1);
  return [p10, p90];
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
    ppuSamples: [],
    adjPairs: 0,
    harshPairs: 0,
    checkerEligible: 0,
    checkerHits: 0,
    color: createColorStatsAcc(),
  };
  for (const binding of scene.enabledFaces) {
    const buf = binding.face.textureId === null ? undefined : buffers.get(binding.face.textureId);
    if (!buf || !sampleFacePixels(binding, buf, acc)) {
      missingFaceTargets.push(`${binding.nodeId}.${binding.direction}`);
    }
  }
  const noiseStats = aggregateBufferNoise(buffers);
  const [lumP10, lumP90] = lumaPercentiles(acc.lumas);
  const upMean = acc.topCount > 0 ? acc.topSum / acc.topCount : 0;
  const downMean = acc.botCount > 0 ? acc.botSum / acc.botCount : 0;
  const ppuStats = finalizePpuStats(acc.ppuSamples);
  const colorStats = finalizeColorStats(acc.color);
  return {
    allFacesCovered: scene.enabledFaces.length > 0 && missingFaceTargets.length === 0,
    missingFaceTargets: missingFaceTargets.slice(0, 8),
    ...noiseStats,
    lumP10,
    lumP90,
    lumRange: Math.max(0, lumP90 - lumP10),
    upDownContrast: acc.topCount > 0 && acc.botCount > 0 ? upMean - downMean : 0,
    ...ppuStats,
    highFreqClutterRate: acc.adjPairs > 0 ? acc.harshPairs / acc.adjPairs : 0,
    checkerRate: acc.checkerEligible > 0 ? acc.checkerHits / acc.checkerEligible : 0,
    ...colorStats,
  };
};
