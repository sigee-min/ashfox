import { encodeUtf8 } from '@ashfox/internal-contracts';
import { MeshoptEncoder } from 'meshoptimizer';

import { stringifyCompactDeterministicJson } from '../../json';
import type { CompiledGltf } from './build';
import type { GltfAccessor, GltfBufferView, GltfDocument } from './contract';
import { poolUncompressedBufferViews } from './primitive';

type MeshoptMode = 'ATTRIBUTES' | 'TRIANGLES' | 'INDICES';

interface BufferViewLayout {
  count: number;
  stride: number;
  mode: MeshoptMode;
}

interface EncodedBufferView {
  layout: BufferViewLayout;
  bytes: Uint8Array;
}

const EXTENSION_JSON_COST = 144;
const align4 = (value: number): number => (value + 3) & ~3;

const componentByteSize = (accessor: GltfAccessor): number => {
  switch (accessor.componentType) {
    case 5120:
    case 5121:
      return 1;
    case 5122:
    case 5123:
      return 2;
    case 5125:
    case 5126:
      return 4;
  }
};

const componentCount = (accessor: GltfAccessor): number => {
  switch (accessor.type) {
    case 'SCALAR':
      return 1;
    case 'VEC2':
      return 2;
    case 'VEC3':
      return 3;
    case 'VEC4':
      return 4;
    case 'MAT4':
      return 16;
  }
};

const triangleAccessorIndices = (document: GltfDocument): ReadonlySet<number> =>
  new Set(
    document.meshes?.flatMap((mesh) =>
      mesh.primitives.flatMap((primitive) =>
        primitive.indices === undefined || primitive.mode !== 4 ? [] : [primitive.indices],
      ),
    ) ?? [],
  );

const accessorsByBufferView = (
  document: GltfDocument,
): ReadonlyMap<number, Array<[number, GltfAccessor]>> => {
  const result = new Map<number, Array<[number, GltfAccessor]>>();
  document.accessors?.forEach((accessor, index) => {
    const entries = result.get(accessor.bufferView) ?? [];
    entries.push([index, accessor]);
    result.set(accessor.bufferView, entries);
  });
  return result;
};

const indexViewLayout = (
  view: GltfBufferView,
  accessors: readonly [number, GltfAccessor][],
  triangles: ReadonlySet<number>,
  count: number,
): BufferViewLayout | null => {
  if (accessors.length !== 1) return null;
  const [accessorIndex, accessor] = accessors[0];
  const stride = componentByteSize(accessor);
  const mode = triangles.has(accessorIndex) ? 'TRIANGLES' : 'INDICES';
  return view.byteLength === count * stride && (mode !== 'TRIANGLES' || count % 3 === 0)
    ? { count, stride, mode }
    : null;
};

const attributeViewLayout = (
  view: GltfBufferView,
  accessors: readonly [number, GltfAccessor][],
  count: number,
): BufferViewLayout | null => {
  const stride = view.byteStride ?? view.byteLength / count;
  if (
    !Number.isSafeInteger(stride) ||
    stride <= 0 ||
    stride > 256 ||
    stride % 4 !== 0 ||
    view.byteLength !== count * stride
  ) {
    return null;
  }
  const fits = accessors.every(
    ([, accessor]) =>
      (accessor.byteOffset ?? 0) + componentByteSize(accessor) * componentCount(accessor) <= stride,
  );
  return fits ? { count, stride, mode: 'ATTRIBUTES' } : null;
};

const layoutForBufferView = (
  view: GltfBufferView,
  accessors: readonly [number, GltfAccessor][],
  triangles: ReadonlySet<number>,
): BufferViewLayout | null => {
  if (view.buffer !== 0 || view.byteLength === 0 || accessors.length === 0) {
    return null;
  }
  const counts = new Set(accessors.map(([, accessor]) => accessor.count));
  if (counts.size !== 1) return null;
  const count = accessors[0][1].count;
  if (count === 0) return null;

  return view.target === 34963
    ? indexViewLayout(view, accessors, triangles, count)
    : attributeViewLayout(view, accessors, count);
};

class AlignedByteWriter {
  private readonly bytes: number[] = [];

  append(source: Uint8Array): number {
    const offset = align4(this.bytes.length);
    while (this.bytes.length < offset) this.bytes.push(0);
    for (const byte of source) this.bytes.push(byte);
    return offset;
  }

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

const appendUncompressedView = (
  writer: AlignedByteWriter,
  view: GltfBufferView,
  source: Uint8Array,
): GltfBufferView => ({
  ...view,
  buffer: 0,
  byteOffset: writer.append(source),
});

const appendCompressedView = (
  writer: AlignedByteWriter,
  view: GltfBufferView,
  encoded: EncodedBufferView,
): GltfBufferView => {
  const { byteOffset: _omitted, ...rest } = view;
  return {
    ...rest,
    buffer: 1,
    extensions: {
      EXT_meshopt_compression: {
        buffer: 0,
        byteOffset: writer.append(encoded.bytes),
        byteLength: encoded.bytes.byteLength,
        byteStride: encoded.layout.stride,
        count: encoded.layout.count,
        mode: encoded.layout.mode,
      },
    },
  };
};

const withExtension = (
  values: GltfDocument['extensionsUsed'],
): NonNullable<GltfDocument['extensionsUsed']> => [
  ...new Set([...(values ?? []), 'EXT_meshopt_compression' as const]),
];

const compiledByteLength = (compiled: CompiledGltf): number =>
  encodeUtf8(stringifyCompactDeterministicJson(compiled.document)).byteLength +
  compiled.binary.byteLength;

const buildCompressedResult = (
  optimized: CompiledGltf,
  encoded: ReadonlyMap<number, EncodedBufferView>,
): CompiledGltf => {
  const writer = new AlignedByteWriter();
  const bufferViews = optimized.document.bufferViews!.map((view, index) => {
    const start = view.byteOffset ?? 0;
    const source = optimized.binary.subarray(start, start + view.byteLength);
    const compressed = encoded.get(index);
    return compressed
      ? appendCompressedView(writer, view, compressed)
      : appendUncompressedView(writer, view, source);
  });
  const binary = writer.toUint8Array();
  const physicalBuffer = optimized.document.buffers?.[0];
  const result: CompiledGltf = {
    ...optimized,
    binary,
    document: {
      ...optimized.document,
      extensionsUsed: withExtension(optimized.document.extensionsUsed),
      extensionsRequired: withExtension(optimized.document.extensionsRequired),
      buffers: [
        {
          byteLength: binary.byteLength,
          ...(physicalBuffer?.uri ? { uri: physicalBuffer.uri } : {}),
        },
        { byteLength: optimized.binary.byteLength },
      ],
      bufferViews,
    },
  };
  const pooled = poolUncompressedBufferViews(result.document, result.binary);
  return { ...result, document: pooled.document, binary: pooled.binary };
};

/** Encodes eligible buffer views with EXT_meshopt_compression when net GLB size shrinks. */
export const encodeMeshoptBufferViews = (optimized: CompiledGltf): CompiledGltf => {
  const triangles = triangleAccessorIndices(optimized.document);
  const accessors = accessorsByBufferView(optimized.document);
  const encoded = new Map<number, EncodedBufferView>();
  optimized.document.bufferViews?.forEach((view, index) => {
    const layout = layoutForBufferView(view, accessors.get(index) ?? [], triangles);
    if (!layout) return;
    const start = view.byteOffset ?? 0;
    const source = optimized.binary.subarray(start, start + view.byteLength);
    const bytes = MeshoptEncoder.encodeGltfBuffer(source, layout.count, layout.stride, layout.mode);
    if (source.byteLength - bytes.byteLength > EXTENSION_JSON_COST) {
      encoded.set(index, { layout, bytes });
    }
  });
  if (encoded.size === 0) return optimized;
  const finalResult = buildCompressedResult(optimized, encoded);
  return compiledByteLength(finalResult) < compiledByteLength(optimized) ? finalResult : optimized;
};
