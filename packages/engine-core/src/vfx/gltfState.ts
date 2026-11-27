import { GltfBinaryWriter } from '../export/targets/gltf/binary';
import type {
  GltfAnimation,
  GltfImage,
  GltfMaterial,
  GltfMesh,
  GltfNode,
  GltfSampler,
} from '../export/targets/gltf/contract';
import { encodeCanonicalPng } from '../textures/textureRecipe/png';
import { createCanonicalTextureRaster } from '../textures/textureRecipe/raster';
import type { VfxBlendMode } from './contract';
import { clampUnit } from './particleGeo';

export const UNIT_SCALE = 1 / 16;

export interface VfxGlbState {
  readonly writer: GltfBinaryWriter;
  readonly nodes: GltfNode[];
  readonly rootNodes: number[];
  readonly meshes: GltfMesh[];
  readonly images: GltfImage[];
  readonly samplers: GltfSampler[];
  readonly materials: GltfMaterial[];
  readonly animations: GltfAnimation[];
  readonly floatCache: Map<string, number>;
}

export const createVfxGlbState = (): VfxGlbState => ({
  writer: new GltfBinaryWriter(false),
  nodes: [],
  rootNodes: [],
  meshes: [],
  images: [],
  samplers: [],
  materials: [],
  animations: [],
  floatCache: new Map(),
});

const getOrAddFloatAccessor = (
  state: VfxGlbState,
  values: readonly number[],
  componentCount: 1 | 3 | 4,
  includeBounds: boolean,
): number => {
  if (values.length <= 24) {
    const key = `${componentCount}:${includeBounds ? 1 : 0}:${values.map((v) => Math.fround(v)).join(',')}`;
    const cached = state.floatCache.get(key);
    if (cached !== undefined) return cached;
    const acc = state.writer.addFloatAccessor(values, componentCount, includeBounds);
    state.floatCache.set(key, acc);
    return acc;
  }
  return state.writer.addFloatAccessor(values, componentCount, includeBounds);
};

export const uploadTextureImage = (
  state: VfxGlbState,
  name: string,
  width: number,
  height: number,
  rgba: Uint8Array,
): number => {
  const raster = createCanonicalTextureRaster(width, height, rgba);
  const png = encodeCanonicalPng(raster);
  const bufferView = state.writer.addBufferView(png);
  const imageIndex = state.images.length;
  state.images.push({ bufferView, mimeType: 'image/png', name });
  state.samplers.push({ magFilter: 9729, minFilter: 9729, wrapS: 10497, wrapT: 10497 });
  return imageIndex;
};

export const addUnlitMaterial = (
  state: VfxGlbState,
  name: string,
  imageIndex: number | undefined,
  blendMode: VfxBlendMode,
  doubleSided: boolean,
  colorFactor: readonly [number, number, number, number] = [1, 1, 1, 1],
): number => {
  const matIndex = state.materials.length;
  const hasTint = colorFactor.some((v, idx) => Math.abs(v - 1) > 1e-4 || (idx === 3 && v < 0.9999));
  state.materials.push({
    name,
    pbrMetallicRoughness: {
      ...(imageIndex !== undefined ? { baseColorTexture: { index: imageIndex } } : {}),
      ...(hasTint
        ? {
            baseColorFactor: [
              Number(colorFactor[0].toFixed(4)),
              Number(colorFactor[1].toFixed(4)),
              Number(colorFactor[2].toFixed(4)),
              Number(clampUnit(colorFactor[3]).toFixed(4)),
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
  return matIndex;
};

export const addAnimatedChannel = (
  state: VfxGlbState,
  anim: GltfAnimation,
  node: number,
  path: 'translation' | 'rotation' | 'scale',
  times: readonly number[],
  values: readonly number[],
  componentCount: 3 | 4,
  interpolation: 'LINEAR' | 'STEP',
): void => {
  const cleanTimes: number[] = [];
  const cleanValues: number[] = [];
  let prevF32 = -Infinity;
  for (let i = 0; i < times.length; i += 1) {
    const f32 = Math.fround(times[i]!);
    if (f32 <= prevF32) continue;
    prevF32 = f32;
    cleanTimes.push(times[i]!);
    const base = i * componentCount;
    for (let c = 0; c < componentCount; c += 1) cleanValues.push(values[base + c]!);
  }
  if (cleanTimes.length === 0) return;
  const input = getOrAddFloatAccessor(state, cleanTimes, 1, true);
  const output =
    path === 'rotation'
      ? state.writer.addNormalizedShortAccessor(cleanValues, 4)
      : getOrAddFloatAccessor(state, cleanValues, componentCount, false);
  const sampler = anim.samplers.length;
  anim.samplers.push({ input, output, interpolation });
  anim.channels.push({ sampler, target: { node, path } });
};

export const addStaticElementMesh = (
  state: VfxGlbState,
  name: string,
  posAcc: number,
  normAcc: number,
  uvAcc: number | undefined,
  indices: number,
  matIndex: number,
): number => {
  const meshIndex = state.meshes.length;
  state.meshes.push({
    name,
    primitives: [
      {
        attributes: {
          POSITION: posAcc,
          NORMAL: normAcc,
          ...(uvAcc !== undefined ? { TEXCOORD_0: uvAcc } : {}),
        },
        indices,
        material: matIndex,
        mode: 4,
      },
    ],
  });
  return meshIndex;
};
