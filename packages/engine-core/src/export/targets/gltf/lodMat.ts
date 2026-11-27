import type { StructureBakedBatch } from '../../../compiler/structure/contract';
import type { ProjectDocument } from '../../../model';
import type { CubeFaceDirection } from '../../../model/scene';
import { decodeBase64Bytes } from '../../../textures/textureRecipe/base64';
import { encodeCanonicalPng } from '../../../textures/textureRecipe/png';
import {
  rasterizeTexture,
  rasterizeTextureSpec,
  type CanonicalTextureRaster,
} from '../../../textures/textureRecipe/raster';
import type { Vec3 } from '../../../model/identity';
import type { TextureAsset } from '../../../model/texture';
import type { GltfImage, GltfMaterial, GltfSampler, GltfTexture } from './contract';
import type { GltfBinaryWriter } from './binary';
import type { UvTransform } from './vertexLayout';

export interface LodMaterialState {
  readonly textures: GltfTexture[];
  readonly images: GltfImage[];
  readonly samplers: GltfSampler[];
  readonly materials: GltfMaterial[];
  readonly bvOff: number;
  readonly writer: GltfBinaryWriter;
  usesTextureTransform: boolean;
}

const uvTransformKey = (uvTx: UvTransform): string =>
  `${uvTx.offset.join(',')},${uvTx.scale.join(',')}`;

const ensureLodAuxTexture = (
  st: LodMaterialState,
  name: string,
  b64: string | undefined,
  samp: number,
): number | undefined => {
  if (!b64) return undefined;
  const existing = st.textures.findIndex((t) => t.name === name);
  if (existing >= 0) return existing;
  const img =
    st.images.push({
      bufferView: st.bvOff + st.writer.addBufferView(decodeBase64Bytes(b64)),
      mimeType: 'image/png',
      name,
    }) - 1;
  return st.textures.push({ sampler: samp, source: img, name }) - 1;
};

const ensureLodTexture = (
  st: LodMaterialState,
  tex: TextureAsset,
): { readonly tid: number; readonly mrTid?: number; readonly normalTid?: number } | undefined => {
  const existing = st.textures.findIndex((t) => t.name === tex.name);
  if (existing >= 0) {
    const samp = st.textures[existing]?.sampler ?? 0;
    return {
      tid: existing,
      mrTid: ensureLodAuxTexture(st, `${tex.name}_mr`, tex.pbr?.metallicRoughnessPngBase64, samp),
      normalTid: ensureLodAuxTexture(st, `${tex.name}_normal`, tex.pbr?.normalPngBase64, samp),
    };
  }
  if (!tex.raster) return undefined;
  const png = encodeCanonicalPng(rasterizeTextureSpec(tex.width, tex.height, tex.raster));
  const img =
    st.images.push({
      bufferView: st.bvOff + st.writer.addBufferView(png),
      mimeType: 'image/png',
      name: tex.name,
    }) - 1;
  const f = tex.sampling === 'nearest' ? 9728 : 9729;
  const samp = st.samplers.push({ magFilter: f, minFilter: f, wrapS: 10497, wrapT: 10497 }) - 1;
  const tid = st.textures.push({ sampler: samp, source: img, name: tex.name }) - 1;
  return {
    tid,
    mrTid: ensureLodAuxTexture(st, `${tex.name}_mr`, tex.pbr?.metallicRoughnessPngBase64, samp),
    normalTid: ensureLodAuxTexture(st, `${tex.name}_normal`, tex.pbr?.normalPngBase64, samp),
  };
};

const lodLayerAlpha = (layer: StructureBakedBatch['layer']): Partial<GltfMaterial> => {
  if (layer === 'cutout') return { alphaMode: 'MASK', alphaCutoff: 0.5, doubleSided: true };
  if (layer === 'translucent' || layer === 'sun_shaft')
    return { alphaMode: 'BLEND', doubleSided: true };
  return {};
};

const buildLodUvExt = (uvTx?: UvTransform) =>
  uvTx
    ? {
        KHR_texture_transform: {
          offset: [...uvTx.offset] as [number, number],
          scale: [...uvTx.scale] as [number, number],
        },
      }
    : undefined;

const buildLodTexInfo = (
  index: number | undefined,
  ext: ReturnType<typeof buildLodUvExt>,
  scale?: number,
) => {
  if (index === undefined) return undefined;
  return {
    index,
    ...(scale !== undefined && scale !== 1 ? { scale } : {}),
    ...(ext ? { extensions: ext } : {}),
  };
};

const buildLodMaterialPayload = (
  tex: TextureAsset,
  resolved: { readonly tid: number; readonly mrTid?: number; readonly normalTid?: number },
  layer: StructureBakedBatch['layer'],
  uvTx?: UvTransform,
): GltfMaterial => {
  const ext = buildLodUvExt(uvTx);
  const texInfo = { index: resolved.tid, ...(ext ? { extensions: ext } : {}) };
  const mrInfo = buildLodTexInfo(resolved.mrTid, ext);
  const normalInfo =
    layer === 'sun_shaft'
      ? undefined
      : buildLodTexInfo(resolved.normalTid, ext, tex.pbr?.normalScale);
  const emissive = layer === 'emissive' || tex.renderMode === 'emissive';
  return {
    name: tex.name,
    pbrMetallicRoughness: {
      baseColorTexture: texInfo,
      ...(mrInfo ? { metallicRoughnessTexture: mrInfo } : {}),
      metallicFactor: mrInfo ? 1 : (tex.pbr?.metallic ?? 0),
      roughnessFactor: mrInfo ? 1 : (tex.pbr?.roughness ?? 0.88),
    },
    ...(normalInfo ? { normalTexture: normalInfo } : {}),
    ...(mrInfo ? { occlusionTexture: mrInfo } : {}),
    ...(emissive
      ? { emissiveTexture: texInfo, emissiveFactor: [1, 1, 1] as [number, number, number] }
      : {}),
    ...lodLayerAlpha(layer),
  };
};

/** Resolve or create a LOD glTF material for a structure baked layer. */
export const resolveLodMaterial = (
  st: LodMaterialState,
  tex: TextureAsset | undefined,
  layer: StructureBakedBatch['layer'],
  mats: Map<string, number>,
  uvTx?: UvTransform,
): number | undefined => {
  if (!tex) return undefined;
  const uvKey = uvTx ? `:uv(${uvTransformKey(uvTx)})` : '';
  const key = `${tex.name}:${layer}${uvKey}`;
  const hit = mats.get(key);
  if (hit !== undefined) return hit;
  const resolved = ensureLodTexture(st, tex);
  if (resolved === undefined) return undefined;
  if (uvTx) st.usesTextureTransform = true;
  const mid = st.materials.push(buildLodMaterialPayload(tex, resolved, layer, uvTx)) - 1;
  mats.set(key, mid);
  return mid;
};

/** Compute mean opaque RGB across a UV rectangle inside a rasterized texture. */
export const averageUvRgb = (
  r: CanonicalTextureRaster,
  uv: readonly [number, number, number, number],
): Vec3 => {
  const [u0, v0] = [
    Math.max(0, Math.min(r.width - 1, Math.floor(Math.min(uv[0], uv[2])))),
    Math.max(0, Math.min(r.height - 1, Math.floor(Math.min(uv[1], uv[3])))),
  ];
  const [u1, v1] = [
    Math.max(u0 + 1, Math.min(r.width, Math.ceil(Math.max(uv[0], uv[2])))),
    Math.max(v0 + 1, Math.min(r.height, Math.ceil(Math.max(uv[1], uv[3])))),
  ];
  let [sr, sg, sb, n] = [0, 0, 0, 0];
  for (let v = v0; v < v1; v += 1) {
    for (let u = u0; u < u1; u += 1) {
      const off = (v * r.width + u) * 4;
      if ((r.rgba.at(off + 3) ?? 0) === 0) continue;
      [sr, sg, sb, n] = [
        sr + (r.rgba.at(off) ?? 0),
        sg + (r.rgba.at(off + 1) ?? 0),
        sb + (r.rgba.at(off + 2) ?? 0),
        n + 1,
      ];
    }
  }
  return n === 0 ? [0.65, 0.65, 0.65] : [sr / (n * 255), sg / (n * 255), sb / (n * 255)];
};

const SHADE: Readonly<Record<CubeFaceDirection, number>> = {
  up: 1.0,
  north: 0.9,
  south: 0.9,
  east: 0.82,
  west: 0.82,
  down: 0.68,
};

/** Resolve directional shaded face color for model LOD2 vertex coloring. */
export const resolveLod2FaceColor = (
  doc: ProjectDocument,
  rasters: Map<string, CanonicalTextureRaster | null>,
  colorsCache: Map<string, Vec3>,
  dir: CubeFaceDirection,
  tid: string | null,
  uv?: readonly [number, number, number, number],
): readonly [number, number, number] => {
  const sh = SHADE[dir];
  if (!tid || !uv) return [0.65 * sh, 0.65 * sh, 0.65 * sh];
  const key = `${tid}:${uv.join(',')}`;
  let base = colorsCache.get(key);
  if (!base) {
    let ras = rasters.get(tid);
    if (ras === undefined) {
      const tex = doc.textures[tid];
      rasters.set(tid, (ras = tex?.raster ? rasterizeTexture(doc, tex) : null));
    }
    colorsCache.set(key, (base = ras ? averageUvRgb(ras, uv) : [0.65, 0.65, 0.65]));
  }
  return [base[0] * sh, base[1] * sh, base[2] * sh];
};

/** Encode ordered canonical textures + metallicRoughness + normal maps into GLB buffers. */
export const encodeOrderedGltfTextures = (
  ordered: readonly TextureAsset[],
  writer: GltfBinaryWriter,
) => {
  const images: GltfImage[] = [];
  const samplers: GltfSampler[] = [];
  const gltfTextures: GltfTexture[] = [];
  const texIndexById = new Map<string, number>();
  const mrTexIndexById = new Map<string, number>();
  const normalTexIndexById = new Map<string, number>();
  for (const tex of ordered) {
    const filter = tex.sampling === 'nearest' ? 9728 : 9729;
    const png = encodeCanonicalPng(rasterizeTextureSpec(tex.width, tex.height, tex.raster!));
    const imgIdx =
      images.push({
        bufferView: writer.addBufferView(png),
        mimeType: 'image/png',
        name: tex.name,
      }) - 1;
    const sampIdx =
      samplers.push({ magFilter: filter, minFilter: filter, wrapS: 10497, wrapT: 10497 }) - 1;
    texIndexById.set(
      tex.id,
      gltfTextures.push({ sampler: sampIdx, source: imgIdx, name: tex.name }) - 1,
    );
    const b64 = tex.pbr?.metallicRoughnessPngBase64;
    if (b64) {
      const mrImgIdx =
        images.push({
          bufferView: writer.addBufferView(decodeBase64Bytes(b64)),
          mimeType: 'image/png',
          name: `${tex.name}_mr`,
        }) - 1;
      mrTexIndexById.set(
        tex.id,
        gltfTextures.push({ sampler: sampIdx, source: mrImgIdx, name: `${tex.name}_mr` }) - 1,
      );
    }
    const normalB64 = tex.pbr?.normalPngBase64;
    if (normalB64) {
      const nImgIdx =
        images.push({
          bufferView: writer.addBufferView(decodeBase64Bytes(normalB64)),
          mimeType: 'image/png',
          name: `${tex.name}_normal`,
        }) - 1;
      normalTexIndexById.set(
        tex.id,
        gltfTextures.push({ sampler: sampIdx, source: nImgIdx, name: `${tex.name}_normal` }) - 1,
      );
    }
  }
  return { images, samplers, gltfTextures, texIndexById, mrTexIndexById, normalTexIndexById };
};
