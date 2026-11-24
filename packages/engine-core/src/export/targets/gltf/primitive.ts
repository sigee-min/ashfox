import type { GltfBinaryWriter } from './binary';
import type { GltfPrimitive } from './contract';

export const compileGltfPrimitive = (
  writer: GltfBinaryWriter,
  positions: readonly number[],
  normals: readonly number[],
  uvs: readonly number[] | undefined,
  joints: readonly number[] | undefined,
  material: number | undefined,
  indices: readonly number[],
  extras?: { readonly ashfoxSourceNodeId: string },
): GltfPrimitive => {
  const attributes = writer.addInterleavedVertexAccessors(positions, normals, uvs, joints);
  return {
    attributes: {
      POSITION: attributes.position,
      NORMAL: attributes.normal,
      ...(attributes.uv === undefined ? {} : { TEXCOORD_0: attributes.uv }),
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
    ...(extras === undefined ? {} : { extras }),
  };
};
