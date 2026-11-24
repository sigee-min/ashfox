import { MeshoptEncoder } from 'meshoptimizer';

import { stringifyCompactDeterministicJson } from '../../json';
import type { CompiledGltf } from './build';
import type { GltfAccessor, GltfBufferView, GltfDocument } from './contract';

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

interface ReorderCandidate {
  vertexView: number;
  indexView: number;
  vertexCount: number;
  vertexStride: number;
  indexCount: number;
  indexComponentType: 5123 | 5125;
}

const EXTENSION_JSON_COST = 144;
const align4 = (value: number): number => (value + 3) & ~3;

const componentByteSize = (accessor: GltfAccessor): number => {
  switch (accessor.componentType) {
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

const increment = (counts: Map<number, number>, key: number): void => {
  counts.set(key, (counts.get(key) ?? 0) + 1);
};

const reorderCandidates = (document: GltfDocument): ReorderCandidate[] => {
  const accessors = document.accessors;
  const views = document.bufferViews;
  if (!accessors || !views) return [];
  const candidates: ReorderCandidate[] = [];
  const vertexUses = new Map<number, number>();
  const indexUses = new Map<number, number>();
  for (const mesh of document.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      if (primitive.mode !== 4 || primitive.indices === undefined) continue;
      const position = accessors[primitive.attributes.POSITION];
      const index = accessors[primitive.indices];
      if (!position || !index || (index.componentType !== 5123 && index.componentType !== 5125)) {
        continue;
      }
      const vertexView = views[position.bufferView];
      const indexView = views[index.bufferView];
      const attributes = Object.values(primitive.attributes).map(
        (accessorIndex) => accessors[accessorIndex],
      );
      const stride =
        vertexView?.byteStride ?? (vertexView ? vertexView.byteLength / position.count : 0);
      const indexSize = index.componentType === 5125 ? 4 : 2;
      if (
        !vertexView ||
        !indexView ||
        vertexView.buffer !== 0 ||
        indexView.buffer !== 0 ||
        vertexView.target !== 34962 ||
        indexView.target !== 34963 ||
        !Number.isSafeInteger(stride) ||
        stride <= 0 ||
        vertexView.byteLength !== position.count * stride ||
        (index.byteOffset ?? 0) !== 0 ||
        indexView.byteLength !== index.count * indexSize ||
        attributes.some(
          (accessor) =>
            !accessor ||
            accessor.bufferView !== position.bufferView ||
            accessor.count !== position.count,
        )
      ) {
        continue;
      }
      candidates.push({
        vertexView: position.bufferView,
        indexView: index.bufferView,
        vertexCount: position.count,
        vertexStride: stride,
        indexCount: index.count,
        indexComponentType: index.componentType,
      });
      increment(vertexUses, position.bufferView);
      increment(indexUses, index.bufferView);
    }
  }
  return candidates.filter(
    ({ vertexView, indexView }) =>
      vertexUses.get(vertexView) === 1 && indexUses.get(indexView) === 1,
  );
};

const readIndices = (
  source: Uint8Array,
  count: number,
  componentType: 5123 | 5125,
): Uint32Array => {
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  return Uint32Array.from({ length: count }, (_, index) =>
    componentType === 5125 ? view.getUint32(index * 4, true) : view.getUint16(index * 2, true),
  );
};

const writeIndices = (
  target: Uint8Array,
  indices: Uint32Array,
  componentType: 5123 | 5125,
): void => {
  const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
  indices.forEach((index, offset) => {
    if (componentType === 5125) {
      view.setUint32(offset * 4, index, true);
    } else {
      view.setUint16(offset * 2, index, true);
    }
  });
};

const reorderMeshData = (compiled: CompiledGltf): CompiledGltf => {
  const views = compiled.document.bufferViews;
  if (!views) return compiled;
  let binary: Uint8Array | undefined;
  for (const candidate of reorderCandidates(compiled.document)) {
    const vertexView = views[candidate.vertexView];
    const indexView = views[candidate.indexView];
    const indexSource = compiled.binary.subarray(
      indexView.byteOffset,
      indexView.byteOffset + indexView.byteLength,
    );
    const indices = readIndices(indexSource, candidate.indexCount, candidate.indexComponentType);
    const [remap, unique] = MeshoptEncoder.reorderMesh(indices, true, false);
    if (unique !== candidate.vertexCount || remap.length !== candidate.vertexCount) {
      continue;
    }
    const vertexSource = compiled.binary.subarray(
      vertexView.byteOffset,
      vertexView.byteOffset + vertexView.byteLength,
    );
    const reordered = new Uint8Array(vertexSource.byteLength);
    for (let oldVertex = 0; oldVertex < candidate.vertexCount; oldVertex += 1) {
      const newVertex = remap[oldVertex];
      if (newVertex === 0xffffffff) continue;
      const start = oldVertex * candidate.vertexStride;
      reordered.set(
        vertexSource.subarray(start, start + candidate.vertexStride),
        newVertex * candidate.vertexStride,
      );
    }
    binary ??= compiled.binary.slice();
    binary.set(reordered, vertexView.byteOffset);
    writeIndices(
      binary.subarray(indexView.byteOffset, indexView.byteOffset + indexView.byteLength),
      indices,
      candidate.indexComponentType,
    );
  }
  return binary ? { ...compiled, binary } : compiled;
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

  if (view.target === 34963) {
    if (accessors.length !== 1) return null;
    const [accessorIndex, accessor] = accessors[0];
    const stride = componentByteSize(accessor);
    const mode = triangles.has(accessorIndex) ? 'TRIANGLES' : 'INDICES';
    return view.byteLength === count * stride && (mode !== 'TRIANGLES' || count % 3 === 0)
      ? { count, stride, mode }
      : null;
  }

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
): GltfBufferView => ({
  ...view,
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
});

const withExtension = (
  values: GltfDocument['extensionsUsed'],
): NonNullable<GltfDocument['extensionsUsed']> => [
  ...new Set([...(values ?? []), 'EXT_meshopt_compression' as const]),
];

const compiledByteLength = (compiled: CompiledGltf): number =>
  new TextEncoder().encode(stringifyCompactDeterministicJson(compiled.document)).byteLength +
  compiled.binary.byteLength;

export const compressGltfWithMeshopt = async (compiled: CompiledGltf): Promise<CompiledGltf> => {
  if (
    compiled.binary.byteLength === 0 ||
    !compiled.document.bufferViews ||
    !compiled.document.accessors ||
    !MeshoptEncoder.supported
  ) {
    return compiled;
  }
  try {
    await MeshoptEncoder.ready;
  } catch {
    return compiled;
  }
  const optimized = reorderMeshData(compiled);
  const triangles = triangleAccessorIndices(optimized.document);
  const accessors = accessorsByBufferView(optimized.document);
  const encoded = new Map<number, EncodedBufferView>();
  optimized.document.bufferViews?.forEach((view, index) => {
    const layout = layoutForBufferView(view, accessors.get(index) ?? [], triangles);
    if (!layout) return;
    const source = optimized.binary.subarray(view.byteOffset, view.byteOffset + view.byteLength);
    const bytes = MeshoptEncoder.encodeGltfBuffer(source, layout.count, layout.stride, layout.mode);
    if (source.byteLength - bytes.byteLength > EXTENSION_JSON_COST) {
      encoded.set(index, { layout, bytes });
    }
  });
  if (encoded.size === 0) return optimized;

  const writer = new AlignedByteWriter();
  const bufferViews = optimized.document.bufferViews!.map((view, index) => {
    const source = optimized.binary.subarray(view.byteOffset, view.byteOffset + view.byteLength);
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
        {
          byteLength: optimized.binary.byteLength,
        },
      ],
      bufferViews,
    },
  };
  return compiledByteLength(result) < compiledByteLength(optimized) ? result : optimized;
};
