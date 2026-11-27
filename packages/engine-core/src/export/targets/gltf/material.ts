import type { TextureAsset } from '../../../model';
import type { GltfMaterial } from './contract';
import type { UvTransform } from './vertexLayout';

const resolveGltfBlendMode = (
  texture: TextureAsset,
): 'additive' | 'blend' | 'premul' | undefined => {
  const raw = texture.metadata?.ashfoxBlendMode;
  if (raw === 'additive' || raw === 'blend' || raw === 'premul') return raw;
  return texture.renderMode === 'additive' ? 'additive' : undefined;
};

const resolveGltfAlphaMode = (
  texture: TextureAsset,
  masked: boolean,
): { alphaMode?: 'MASK' | 'BLEND'; alphaCutoff?: number } => {
  if (masked) return { alphaMode: 'MASK', alphaCutoff: 0.5 };
  if (texture.renderMode === 'additive' || texture.renderMode === 'layered') {
    return { alphaMode: 'BLEND' };
  }
  return {};
};

const buildEmissiveFields = (
  isEmissive: boolean,
  isUnlit: boolean,
  texInfo: { readonly index: number; readonly extensions?: Record<string, unknown> },
): Partial<GltfMaterial> =>
  isEmissive && !isUnlit
    ? { emissiveTexture: texInfo, emissiveFactor: [1, 1, 1] as [number, number, number] }
    : {};

const buildUvExt = (uvTransform?: UvTransform) =>
  uvTransform
    ? {
        KHR_texture_transform: {
          offset: [uvTransform.offset[0], uvTransform.offset[1]] as [number, number],
          scale: [uvTransform.scale[0], uvTransform.scale[1]] as [number, number],
        },
      }
    : undefined;

const buildTexInfo = (
  index: number | undefined,
  ext: ReturnType<typeof buildUvExt>,
  scale?: number,
) =>
  index === undefined
    ? undefined
    : {
        index,
        ...(scale !== undefined && scale !== 1 ? { scale } : {}),
        ...(ext ? { extensions: ext } : {}),
      };

/** Build a glTF PBR material payload with optional metallic-roughness and normal maps. */
export const createGltfMaterial = (
  texture: TextureAsset,
  texIndex: number,
  masked: boolean,
  doubleSided: boolean,
  isEmissive = texture.renderMode === 'emissive',
  uvTransform?: UvTransform,
  name = texture.name,
  mrTexIndex?: number,
  normalTexIndex?: number,
): GltfMaterial => {
  const ext = buildUvExt(uvTransform);
  const isUnlit = texture.renderMode === 'additive' || texture.metadata?.ashfoxUnlit === true;
  const blendMode = resolveGltfBlendMode(texture);
  const mrInfo = buildTexInfo(mrTexIndex, ext);
  const normalInfo = isUnlit
    ? undefined
    : buildTexInfo(normalTexIndex, ext, texture.pbr?.normalScale);
  const texInfo = { index: texIndex, ...(ext ? { extensions: ext } : {}) };
  return {
    name,
    pbrMetallicRoughness: {
      baseColorTexture: texInfo,
      ...(mrInfo ? { metallicRoughnessTexture: mrInfo } : {}),
      metallicFactor: mrInfo ? 1 : (texture.pbr?.metallic ?? 0),
      roughnessFactor: mrInfo ? 1 : (texture.pbr?.roughness ?? 0.88),
    },
    ...(normalInfo ? { normalTexture: normalInfo } : {}),
    ...(mrInfo ? { occlusionTexture: mrInfo } : {}),
    ...buildEmissiveFields(isEmissive, isUnlit, texInfo),
    ...resolveGltfAlphaMode(texture, masked),
    ...(doubleSided ? { doubleSided: true } : {}),
    ...(isUnlit ? { extensions: { KHR_materials_unlit: {} } } : {}),
    ...(blendMode ? { extras: { ashfoxBlendMode: blendMode } } : {}),
  };
};

/** Build an unlit glTF material payload for VFX elements and particle bursts. */
export const createUnlitMaterial = (
  name: string,
  imageIndex: number | undefined,
  blendMode: 'additive' | 'blend' | 'premul',
  doubleSided: boolean,
  baseColorFactor?: readonly [number, number, number, number],
): GltfMaterial => ({
  name,
  pbrMetallicRoughness: {
    ...(imageIndex !== undefined ? { baseColorTexture: { index: imageIndex } } : {}),
    ...(baseColorFactor
      ? {
          baseColorFactor: [
            baseColorFactor[0],
            baseColorFactor[1],
            baseColorFactor[2],
            baseColorFactor[3],
          ],
        }
      : {}),
    metallicFactor: 0,
    roughnessFactor: 1,
  },
  alphaMode: 'BLEND',
  ...(doubleSided ? { doubleSided: true } : {}),
  extensions: { KHR_materials_unlit: {} },
  extras: { ashfoxBlendMode: blendMode },
});
