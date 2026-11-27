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

/** Build a glTF PBR material payload with optional metallic-roughness map and blend overrides. */
export const createGltfMaterial = (
  texture: TextureAsset,
  texIndex: number,
  masked: boolean,
  doubleSided: boolean,
  isEmissive = texture.renderMode === 'emissive',
  uvTransform?: UvTransform,
  name = texture.name,
  mrTexIndex?: number,
): GltfMaterial => {
  const ext = uvTransform
    ? {
        KHR_texture_transform: {
          offset: [uvTransform.offset[0], uvTransform.offset[1]] as [number, number],
          scale: [uvTransform.scale[0], uvTransform.scale[1]] as [number, number],
        },
      }
    : undefined;
  const isUnlit = texture.renderMode === 'additive' || texture.metadata?.ashfoxUnlit === true;
  const blendMode = resolveGltfBlendMode(texture);
  const mrInfo =
    mrTexIndex === undefined
      ? undefined
      : { index: mrTexIndex, ...(ext ? { extensions: ext } : {}) };
  const texInfo = { index: texIndex, ...(ext ? { extensions: ext } : {}) };
  return {
    name,
    pbrMetallicRoughness: {
      baseColorTexture: texInfo,
      ...(mrInfo ? { metallicRoughnessTexture: mrInfo } : {}),
      metallicFactor: mrInfo ? 1 : (texture.pbr?.metallic ?? 0),
      roughnessFactor: mrInfo ? 1 : (texture.pbr?.roughness ?? 0.88),
    },
    ...(mrInfo ? { occlusionTexture: mrInfo } : {}),
    ...buildEmissiveFields(isEmissive, isUnlit, texInfo),
    ...resolveGltfAlphaMode(texture, masked),
    ...(doubleSided ? { doubleSided: true } : {}),
    ...(isUnlit ? { extensions: { KHR_materials_unlit: {} } } : {}),
    ...(blendMode ? { extras: { ashfoxBlendMode: blendMode } } : {}),
  };
};
