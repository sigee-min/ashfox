import type { CompiledModel } from '../model/compiled';
import type { TextureAsset } from '../model/texture';
import { srgbLuma } from '../textures/color';
import { canonicalRgbaBackingBuffer, rasterizeTextureSpec } from '../textures/textureRecipe/raster';
import type { AuditSceneGeometry } from './geometry';
import { decodePngBase64Rgba } from './pngDecode';

interface CachedTexData {
  readonly width: number;
  readonly height: number;
  readonly albedoRgba: Uint8Array;
  readonly pbrRgba: Uint8Array | null;
  readonly defaultMetallic: number;
}

interface ChartAcc {
  count: number;
  lumaSum: number;
  metSum: number;
}

const loadTexData = (tex: TextureAsset): CachedTexData | null => {
  if (!tex.raster || tex.renderMode === 'emissive') return null;
  const ras = rasterizeTextureSpec(tex.width, tex.height, tex.raster);
  const albedoRgba = canonicalRgbaBackingBuffer(ras.rgba) ?? ras.rgba.copy();
  const decoded = tex.pbr?.metallicRoughnessPngBase64
    ? decodePngBase64Rgba(tex.pbr.metallicRoughnessPngBase64)
    : null;
  const pbrRgba =
    decoded && decoded.width === tex.width && decoded.height === tex.height ? decoded.rgba : null;
  return {
    width: tex.width,
    height: tex.height,
    albedoRgba,
    pbrRgba,
    defaultMetallic: tex.pbr?.metallic ?? 0,
  };
};

const addFaceHeadroom = (
  data: CachedTexData,
  uv: readonly [number, number, number, number],
  acc: ChartAcc,
): void => {
  const x0 = Math.max(0, Math.floor(Math.min(uv[0], uv[2])));
  const x1 = Math.min(data.width, Math.ceil(Math.max(uv[0], uv[2])));
  const y0 = Math.max(0, Math.floor(Math.min(uv[1], uv[3])));
  const y1 = Math.min(data.height, Math.ceil(Math.max(uv[1], uv[3])));
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const p = (y * data.width + x) * 4;
      if (data.albedoRgba[p + 3] !== 255) continue;
      acc.count += 1;
      acc.lumaSum += srgbLuma(
        data.albedoRgba[p]!,
        data.albedoRgba[p + 1]!,
        data.albedoRgba[p + 2]!,
      );
      acc.metSum += data.pbrRgba ? data.pbrRgba[p + 2]! / 255 : data.defaultMetallic;
    }
  }
};

const isChartHeadroomBad = (acc: ChartAcc): boolean => {
  if (acc.count === 0) return false;
  const meanL = acc.lumaSum / acc.count;
  const meanM = acc.metSum / acc.count;
  return (meanM >= 0.6 && meanL < 0.42) || (meanM < 0.2 && acc.count >= 64 && meanL > 0.94);
};

const resolveCachedTex = (
  texId: string,
  model: CompiledModel,
  texCache: Map<string, CachedTexData | null>,
): CachedTexData | null => {
  const existing = texCache.get(texId);
  if (existing !== undefined) return existing;
  const tex = model.textures[texId];
  const loaded = tex ? loadTexData(tex) : null;
  texCache.set(texId, loaded);
  return loaded;
};

/** Return node targets whose chart luminance violates PBR metallic/matte headroom. */
export const findBadPbrHeadroomCharts = (
  model: CompiledModel,
  scene: AuditSceneGeometry,
): readonly string[] => {
  const texCache = new Map<string, CachedTexData | null>();
  const chartStats = new Map<string, { readonly target: string; readonly acc: ChartAcc }>();
  for (const face of scene.enabledFaces) {
    const texId = face.face.textureId;
    if (!texId || !face.face.uv) continue;
    const data = resolveCachedTex(texId, model, texCache);
    if (!data) continue;
    const key = `${face.nodeId}|${texId}`;
    const entry = chartStats.get(key) ?? {
      target: face.nodeId,
      acc: { count: 0, lumaSum: 0, metSum: 0 },
    };
    addFaceHeadroom(data, face.face.uv, entry.acc);
    chartStats.set(key, entry);
  }
  return [...chartStats.values()]
    .filter((entry) => isChartHeadroomBad(entry.acc))
    .map((entry) => entry.target);
};
