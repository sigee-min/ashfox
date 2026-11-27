const MIN_HALF_EXTENT = 1e-6;

const align4 = (value: number): number => (value + 3) & ~3;
const alignTo = (value: number, alignment: number): number =>
  Math.ceil(value / alignment) * alignment;

const fitsNormalizedSigned = (values: readonly number[]): boolean =>
  values.every((value) => Number.isFinite(value) && Math.abs(value) <= 1.000001);

const fitsNormalizedUnsigned = (values: readonly number[]): boolean =>
  values.every((value) => Number.isFinite(value) && value >= -0.000001 && value <= 1.000001);

export interface PositionBounds {
  readonly center: readonly [number, number, number];
  readonly halfExtent: readonly [number, number, number];
}

export interface UvTransform {
  readonly offset: readonly [number, number];
  readonly scale: readonly [number, number];
}

export const computePositionsBounds = (
  positionGroups: readonly (readonly number[])[],
): PositionBounds => {
  const min: [number, number, number] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];
  const max: [number, number, number] = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  for (const positions of positionGroups) {
    for (let i = 0; i < positions.length; i += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        const value = positions[i + axis]!;
        min[axis] = Math.min(min[axis]!, value);
        max[axis] = Math.max(max[axis]!, value);
      }
    }
  }
  if (!Number.isFinite(min[0])) {
    return { center: [0, 0, 0], halfExtent: [1, 1, 1] };
  }
  return {
    center: [(min[0] + max[0]) * 0.5, (min[1] + max[1]) * 0.5, (min[2] + max[2]) * 0.5],
    halfExtent: [
      Math.max((max[0] - min[0]) * 0.5, MIN_HALF_EXTENT),
      Math.max((max[1] - min[1]) * 0.5, MIN_HALF_EXTENT),
      Math.max((max[2] - min[2]) * 0.5, MIN_HALF_EXTENT),
    ],
  };
};

export const normalizePositionsWithBounds = (
  positions: readonly number[],
  bounds: PositionBounds,
): number[] => {
  const result = new Array<number>(positions.length);
  const [cx, cy, cz] = bounds.center;
  const [hx, hy, hz] = bounds.halfExtent;
  for (let i = 0; i < positions.length; i += 3) {
    result[i] = (positions[i]! - cx) / hx;
    result[i + 1] = (positions[i + 1]! - cy) / hy;
    result[i + 2] = (positions[i + 2]! - cz) / hz;
  }
  return result;
};

export const computeUvTransform = (
  uvs: readonly number[],
): { readonly normalizedUvs: readonly number[]; readonly transform?: UvTransform } => {
  if (uvs.length === 0) return { normalizedUvs: uvs };
  let minU = Number.POSITIVE_INFINITY;
  let maxU = Number.NEGATIVE_INFINITY;
  let minV = Number.POSITIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < uvs.length; i += 2) {
    const u = uvs[i]!;
    const v = uvs[i + 1]!;
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  if (minU >= 0 && maxU <= 1 && minV >= 0 && maxV <= 1) {
    return { normalizedUvs: uvs };
  }
  const spanU = Math.max(maxU - minU, MIN_HALF_EXTENT);
  const spanV = Math.max(maxV - minV, MIN_HALF_EXTENT);
  const normalizedUvs = new Array<number>(uvs.length);
  for (let i = 0; i < uvs.length; i += 2) {
    normalizedUvs[i] = (uvs[i]! - minU) / spanU;
    normalizedUvs[i + 1] = (uvs[i + 1]! - minV) / spanV;
  }
  return {
    normalizedUvs,
    transform: { offset: [minU, minV], scale: [spanU, spanV] },
  };
};

export interface VertexLayout {
  positionOffset: number;
  normalOffset: number;
  tangentOffset?: number;
  uvOffset?: number;
  colorOffset?: number;
  colorComponentCount: 3 | 4;
  jointOffset?: number;
  weightOffset?: number;
  stride: number;
  quantizedPosition: boolean;
  quantizedNormal: boolean;
  quantizedTangent: boolean;
  quantizedUv: boolean;
  jointComponentType: 5121 | 5123;
}

const jointSkinLayout = (joints: readonly number[] | undefined, attributeEnd: number) => {
  const jointComponentType: 5121 | 5123 = joints?.some((joint) => joint > 255) ? 5123 : 5121;
  if (!joints) return { end: attributeEnd, jointComponentType };
  const jointSize = jointComponentType === 5123 ? 2 : 1;
  const jointOffset = alignTo(attributeEnd, jointSize);
  const weightOffset = jointOffset + jointSize * 4;
  return { jointOffset, weightOffset, end: weightOffset + 4, jointComponentType };
};

const optionalOffset = (present: boolean, prevEnd: number, size: number) =>
  present
    ? { offset: align4(prevEnd), end: align4(prevEnd) + size }
    : { offset: undefined, end: prevEnd };

export const computeVertexLayout = (
  positions: readonly number[],
  normals: readonly number[],
  uvs: readonly number[] | undefined,
  joints: readonly number[] | undefined,
  colors: readonly number[] | undefined,
  quantize: boolean,
  tangents?: readonly number[],
): VertexLayout => {
  const count = positions.length / 3;
  const colorComponentCount: 3 | 4 = colors?.length === count * 4 ? 4 : 3;
  const quantizedPosition = quantize && fitsNormalizedSigned(positions);
  const quantizedNormal = quantize && fitsNormalizedSigned(normals);
  const quantizedTangent = quantize && tangents !== undefined && fitsNormalizedSigned(tangents);
  const quantizedUv = quantize && uvs !== undefined && fitsNormalizedUnsigned(uvs);
  const normalOffset = align4(quantizedPosition ? 6 : 12);
  const normalEnd = normalOffset + (quantizedNormal ? 4 : 12);
  const tangentSlot = optionalOffset(tangents !== undefined, normalEnd, quantizedTangent ? 4 : 16);
  const uvSlot = optionalOffset(uvs !== undefined, tangentSlot.end, quantizedUv ? 4 : 8);
  const colorSlot = optionalOffset(colors !== undefined, uvSlot.end, 4);
  const skin = jointSkinLayout(joints, colorSlot.end);
  return {
    positionOffset: 0,
    normalOffset,
    ...(tangentSlot.offset === undefined ? {} : { tangentOffset: tangentSlot.offset }),
    ...(uvSlot.offset === undefined ? {} : { uvOffset: uvSlot.offset }),
    ...(colorSlot.offset === undefined ? {} : { colorOffset: colorSlot.offset }),
    colorComponentCount,
    ...(skin.jointOffset === undefined ? {} : { jointOffset: skin.jointOffset }),
    ...(skin.weightOffset === undefined ? {} : { weightOffset: skin.weightOffset }),
    stride: align4(skin.end),
    quantizedPosition,
    quantizedNormal,
    quantizedTangent,
    quantizedUv,
    jointComponentType: skin.jointComponentType,
  };
};

export const assertValidInterleavedInputs = (
  positions: readonly number[],
  normals: readonly number[],
  uvs: readonly number[] | undefined,
  joints: readonly number[] | undefined,
  colors: readonly number[] | undefined,
  tangents?: readonly number[],
): number => {
  if (positions.length % 3 !== 0 || normals.length !== positions.length) {
    throw new Error('glTF vertex positions and normals must be VEC3 pairs.');
  }
  const count = positions.length / 3;
  if (tangents && tangents.length !== count * 4) {
    throw new Error('glTF vertex tangents must be VEC4 matching position count.');
  }
  if (uvs && uvs.length !== count * 2) {
    throw new Error('glTF vertex UVs must match the position count.');
  }
  if (colors && colors.length !== count * 3 && colors.length !== count * 4) {
    throw new Error('glTF vertex COLOR_0 must match VEC3 or VEC4 position count.');
  }
  if (
    joints &&
    (joints.length !== count ||
      joints.some((joint) => !Number.isSafeInteger(joint) || joint < 0 || joint > 65535))
  ) {
    throw new Error('glTF rigid joint indices must match the position count.');
  }
  return count;
};
