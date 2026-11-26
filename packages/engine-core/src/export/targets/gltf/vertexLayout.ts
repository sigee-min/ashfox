const align4 = (value: number): number => (value + 3) & ~3;
const alignTo = (value: number, alignment: number): number =>
  Math.ceil(value / alignment) * alignment;

const fitsNormalizedSigned = (values: readonly number[]): boolean =>
  values.every((value) => Number.isFinite(value) && Math.abs(value) <= 1);
const fitsNormalizedUnsigned = (values: readonly number[]): boolean =>
  values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1);

export interface VertexLayout {
  positionOffset: number;
  normalOffset: number;
  uvOffset?: number;
  colorOffset?: number;
  jointOffset?: number;
  weightOffset?: number;
  stride: number;
  quantizedPosition: boolean;
  quantizedNormal: boolean;
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

export const computeVertexLayout = (
  positions: readonly number[],
  normals: readonly number[],
  uvs: readonly number[] | undefined,
  joints: readonly number[] | undefined,
  colors: readonly number[] | undefined,
  quantize: boolean,
): VertexLayout => {
  const quantizedPosition = quantize && fitsNormalizedSigned(positions);
  const quantizedNormal = quantize && fitsNormalizedSigned(normals);
  const quantizedUv = quantize && uvs !== undefined && fitsNormalizedUnsigned(uvs);
  const normalOffset = align4(quantizedPosition ? 6 : 12);
  const normalEnd = normalOffset + (quantizedNormal ? 6 : 12);
  const uvOffset = uvs ? align4(normalEnd) : undefined;
  const uvEnd = uvOffset === undefined ? normalEnd : uvOffset + (quantizedUv ? 4 : 8);
  const colorOffset = colors ? align4(uvEnd) : undefined;
  const skin = jointSkinLayout(joints, colorOffset === undefined ? uvEnd : colorOffset + 4);
  return {
    positionOffset: 0,
    normalOffset,
    ...(uvOffset === undefined ? {} : { uvOffset }),
    ...(colorOffset === undefined ? {} : { colorOffset }),
    ...(skin.jointOffset === undefined ? {} : { jointOffset: skin.jointOffset }),
    ...(skin.weightOffset === undefined ? {} : { weightOffset: skin.weightOffset }),
    stride: align4(skin.end),
    quantizedPosition,
    quantizedNormal,
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
): number => {
  if (positions.length % 3 !== 0 || normals.length !== positions.length) {
    throw new Error('glTF vertex positions and normals must be VEC3 pairs.');
  }
  const count = positions.length / 3;
  if (uvs && uvs.length !== count * 2) {
    throw new Error('glTF vertex UVs must match the position count.');
  }
  if (colors && colors.length !== count * 3) {
    throw new Error('glTF vertex COLOR_0 must match VEC3 position count.');
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
