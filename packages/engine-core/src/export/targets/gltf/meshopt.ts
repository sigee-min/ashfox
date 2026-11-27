import { MeshoptEncoder } from 'meshoptimizer';

import type { CompiledGltf } from './build';
import type { GltfAccessor, GltfBufferView, GltfDocument } from './contract';
import { encodeMeshoptBufferViews } from './meshoptEncode';

interface ReorderCandidate {
  vertexView: number;
  indexView: number;
  vertexCount: number;
  vertexStride: number;
  indexCount: number;
  indexComponentType: 5123 | 5125;
}

const increment = (counts: Map<number, number>, key: number): void => {
  counts.set(key, (counts.get(key) ?? 0) + 1);
};

const isValidReorderLayout = (
  primitive: NonNullable<GltfDocument['meshes']>[number]['primitives'][number],
  position: GltfAccessor,
  index: GltfAccessor,
  vertexView: GltfBufferView | undefined,
  indexView: GltfBufferView | undefined,
  accessors: readonly GltfAccessor[],
  stride: number,
): boolean => {
  const indexSize = index.componentType === 5125 ? 4 : 2;
  if (
    !vertexView ||
    !indexView ||
    vertexView.buffer !== 0 ||
    indexView.buffer !== 0 ||
    vertexView.target !== 34962 ||
    indexView.target !== 34963
  ) {
    return false;
  }
  if (
    !Number.isSafeInteger(stride) ||
    stride <= 0 ||
    vertexView.byteLength !== position.count * stride ||
    (index.byteOffset ?? 0) !== 0 ||
    indexView.byteLength !== index.count * indexSize
  ) {
    return false;
  }
  return Object.values(primitive.attributes).every((accessorIndex) => {
    const accessor = accessors[accessorIndex];
    return (
      accessor !== undefined &&
      accessor.bufferView === position.bufferView &&
      accessor.count === position.count
    );
  });
};

const primitiveReorderCandidate = (
  primitive: NonNullable<GltfDocument['meshes']>[number]['primitives'][number],
  accessors: readonly GltfAccessor[],
  views: readonly GltfBufferView[],
): ReorderCandidate | null => {
  if (primitive.mode !== 4 || primitive.indices === undefined) return null;
  const position = accessors[primitive.attributes.POSITION];
  const index = accessors[primitive.indices];
  if (!position || !index || (index.componentType !== 5123 && index.componentType !== 5125)) {
    return null;
  }
  const vertexView = views[position.bufferView];
  const indexView = views[index.bufferView];
  const stride =
    vertexView?.byteStride ?? (vertexView ? vertexView.byteLength / position.count : 0);
  if (!isValidReorderLayout(primitive, position, index, vertexView, indexView, accessors, stride)) {
    return null;
  }
  return {
    vertexView: position.bufferView,
    indexView: index.bufferView,
    vertexCount: position.count,
    vertexStride: stride,
    indexCount: index.count,
    indexComponentType: index.componentType,
  };
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
      const candidate = primitiveReorderCandidate(primitive, accessors, views);
      if (!candidate) continue;
      candidates.push(candidate);
      increment(vertexUses, candidate.vertexView);
      increment(indexUses, candidate.indexView);
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
  const indices = new Uint32Array(count);
  if (componentType === 5125) {
    for (let index = 0; index < count; index += 1) {
      indices[index] = view.getUint32(index * 4, true);
    }
  } else {
    for (let index = 0; index < count; index += 1) {
      indices[index] = view.getUint16(index * 2, true);
    }
  }
  return indices;
};

const writeIndices = (
  target: Uint8Array,
  indices: Uint32Array,
  componentType: 5123 | 5125,
): void => {
  const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
  if (componentType === 5125) {
    for (let offset = 0; offset < indices.length; offset += 1) {
      view.setUint32(offset * 4, indices[offset]!, true);
    }
  } else {
    for (let offset = 0; offset < indices.length; offset += 1) {
      view.setUint16(offset * 2, indices[offset]!, true);
    }
  }
};

const reorderVerticesWords = (
  vertexSource: Uint8Array,
  remap: Uint32Array,
  vertexCount: number,
  stride: number,
): Uint8Array => {
  const reordered = new Uint8Array(vertexSource.byteLength);
  const srcWords = new Uint32Array(
    vertexSource.buffer,
    vertexSource.byteOffset,
    vertexSource.byteLength >>> 2,
  );
  const dstWords = new Uint32Array(reordered.buffer);
  const wordStride = stride >>> 2;
  for (let oldVertex = 0; oldVertex < vertexCount; oldVertex += 1) {
    const newVertex = remap[oldVertex]!;
    if (newVertex === 0xffffffff) continue;
    const srcStart = oldVertex * wordStride;
    const dstStart = newVertex * wordStride;
    for (let w = 0; w < wordStride; w += 1) {
      dstWords[dstStart + w] = srcWords[srcStart + w]!;
    }
  }
  return reordered;
};

const reorderVerticesBytes = (
  vertexSource: Uint8Array,
  remap: Uint32Array,
  vertexCount: number,
  stride: number,
): Uint8Array => {
  const reordered = new Uint8Array(vertexSource.byteLength);
  for (let oldVertex = 0; oldVertex < vertexCount; oldVertex += 1) {
    const newVertex = remap[oldVertex]!;
    if (newVertex === 0xffffffff) continue;
    const srcStart = oldVertex * stride;
    const dstStart = newVertex * stride;
    for (let b = 0; b < stride; b += 1) {
      reordered[dstStart + b] = vertexSource[srcStart + b]!;
    }
  }
  return reordered;
};

const reorderVertices = (
  vertexSource: Uint8Array,
  remap: Uint32Array,
  vertexCount: number,
  stride: number,
): Uint8Array =>
  stride % 4 === 0 && (vertexSource.byteOffset & 3) === 0
    ? reorderVerticesWords(vertexSource, remap, vertexCount, stride)
    : reorderVerticesBytes(vertexSource, remap, vertexCount, stride);

const reorderMeshData = (compiled: CompiledGltf): CompiledGltf => {
  const views = compiled.document.bufferViews;
  if (!views) return compiled;
  let binary: Uint8Array | undefined;
  for (const candidate of reorderCandidates(compiled.document)) {
    const vertexView = views[candidate.vertexView];
    const indexView = views[candidate.indexView];
    const indexSource = compiled.binary.subarray(
      indexView.byteOffset ?? 0,
      (indexView.byteOffset ?? 0) + indexView.byteLength,
    );
    const indices = readIndices(indexSource, candidate.indexCount, candidate.indexComponentType);
    const [remap, unique] = MeshoptEncoder.reorderMesh(indices, true, false);
    if (unique !== candidate.vertexCount || remap.length !== candidate.vertexCount) {
      continue;
    }
    const vertexSource = compiled.binary.subarray(
      vertexView.byteOffset ?? 0,
      (vertexView.byteOffset ?? 0) + vertexView.byteLength,
    );
    const reordered = reorderVertices(
      vertexSource,
      remap,
      candidate.vertexCount,
      candidate.vertexStride,
    );
    binary ??= compiled.binary.slice();
    binary.set(reordered, vertexView.byteOffset ?? 0);
    writeIndices(
      binary.subarray(
        indexView.byteOffset ?? 0,
        (indexView.byteOffset ?? 0) + indexView.byteLength,
      ),
      indices,
      candidate.indexComponentType,
    );
  }
  return binary ? { ...compiled, binary } : compiled;
};

/** Reorders triangle vertex/index streams and compresses eligible glTF buffer views with meshopt. */
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
  return encodeMeshoptBufferViews(reorderMeshData(compiled));
};
