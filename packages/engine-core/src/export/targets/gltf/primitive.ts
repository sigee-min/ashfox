import type { GltfBinaryWriter } from './binary';
import type { GltfPrimitive } from './contract';
import {
  computeUvTransform,
  normalizePositionsWithBounds,
  type PositionBounds,
  type UvTransform,
} from './vertexLayout';

export const compileGltfPrimitive = (
  writer: GltfBinaryWriter,
  positions: readonly number[],
  normals: readonly number[],
  uvs: readonly number[] | undefined,
  joints: readonly number[] | undefined,
  material: number | undefined,
  indices: readonly number[],
  colors?: readonly number[],
): GltfPrimitive => {
  const attributes = writer.addInterleavedVertexAccessors(positions, normals, uvs, joints, colors);
  return {
    attributes: {
      POSITION: attributes.position,
      NORMAL: attributes.normal,
      ...(attributes.uv === undefined ? {} : { TEXCOORD_0: attributes.uv }),
      ...(attributes.color === undefined ? {} : { COLOR_0: attributes.color }),
      ...(attributes.joints === undefined || attributes.weights === undefined
        ? {}
        : {
            JOINTS_0: attributes.joints,
            WEIGHTS_0: attributes.weights,
          }),
    },
    indices: writer.addIndexAccessor(indices),
    ...(material === undefined ? {} : { material }),
    mode: 4,
  };
};

export const compileQuantizedGltfPrimitive = (
  writer: GltfBinaryWriter,
  positions: readonly number[],
  normals: readonly number[],
  uvs: readonly number[] | undefined,
  indices: readonly number[],
  bounds: PositionBounds,
  resolveMaterial: (uvTransform: UvTransform | undefined) => number | undefined,
  colors?: readonly number[],
): GltfPrimitive => {
  const quantize = writer.isQuantized;
  const qPositions = quantize ? normalizePositionsWithBounds(positions, bounds) : positions;
  const uvResult = quantize && uvs !== undefined ? computeUvTransform(uvs) : undefined;
  const qUvs = uvResult ? uvResult.normalizedUvs : uvs;
  const matIdx = resolveMaterial(uvResult?.transform);
  return compileGltfPrimitive(
    writer,
    qPositions,
    normals,
    qUvs,
    undefined,
    matIdx,
    indices,
    colors,
  );
};
