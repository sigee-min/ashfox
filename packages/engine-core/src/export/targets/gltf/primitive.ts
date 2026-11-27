import type { GltfBinaryWriter } from './binary';
import type { GltfAccessor, GltfBufferView, GltfDocument, GltfPrimitive } from './contract';
import { computeOrthogonalTangents } from './tangent';
import {
  computeUvTransform,
  normalizePositionsWithBounds,
  type PositionBounds,
  type UvTransform,
} from './vertexLayout';

const align4 = (value: number): number => (value + 3) & ~3;

export const compileGltfPrimitive = (
  writer: GltfBinaryWriter,
  positions: readonly number[],
  normals: readonly number[],
  uvs: readonly number[] | undefined,
  joints: readonly number[] | undefined,
  material: number | undefined,
  indices: readonly number[],
  colors?: readonly number[],
  tangents?: readonly number[],
): GltfPrimitive => {
  const attributes = writer.addInterleavedVertexAccessors(
    positions,
    normals,
    uvs,
    joints,
    colors,
    tangents,
  );
  return {
    attributes: {
      POSITION: attributes.position,
      NORMAL: attributes.normal,
      ...(attributes.tangent === undefined ? {} : { TANGENT: attributes.tangent }),
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
  includeTangents?: (material: number | undefined) => boolean,
): GltfPrimitive => {
  const quantize = writer.isQuantized;
  const qPositions = quantize ? normalizePositionsWithBounds(positions, bounds) : positions;
  const uvResult = quantize && uvs !== undefined ? computeUvTransform(uvs) : undefined;
  const qUvs = uvResult ? uvResult.normalizedUvs : uvs;
  const matIdx = resolveMaterial(uvResult?.transform);
  const tangents =
    includeTangents?.(matIdx) && uvs !== undefined && indices.length >= 3
      ? computeOrthogonalTangents(positions, normals, uvs, indices)
      : undefined;
  return compileGltfPrimitive(
    writer,
    qPositions,
    normals,
    qUvs,
    undefined,
    matIdx,
    indices,
    colors,
    tangents,
  );
};

const isPoolableBufferView = (
  view: GltfBufferView,
  index: number,
  excludedViews: ReadonlySet<number>,
): boolean =>
  view.buffer === 0 &&
  view.target === undefined &&
  view.byteStride === undefined &&
  view.extensions === undefined &&
  view.byteLength > 0 &&
  !excludedViews.has(index);

const buildPooledBytes = (
  views: readonly GltfBufferView[],
  poolable: readonly number[],
  binary: Uint8Array,
): { readonly bytes: Uint8Array; readonly subOffsets: ReadonlyMap<number, number> } => {
  const subOffsets = new Map<number, number>();
  let total = 0;
  for (const idx of poolable) {
    total = align4(total);
    subOffsets.set(idx, total);
    total += views[idx]!.byteLength;
  }
  const bytes = new Uint8Array(total);
  for (const idx of poolable) {
    const v = views[idx]!;
    const start = v.byteOffset ?? 0;
    bytes.set(binary.subarray(start, start + v.byteLength), subOffsets.get(idx)!);
  }
  return { bytes, subOffsets };
};

const remapNonPooledView = (
  view: GltfBufferView,
  binary: Uint8Array,
  pushChunk: (data: Uint8Array) => number,
): GltfBufferView => {
  const meshopt = view.extensions?.EXT_meshopt_compression;
  if (meshopt && meshopt.buffer === 0) {
    const offset = pushChunk(
      binary.subarray(meshopt.byteOffset, meshopt.byteOffset + meshopt.byteLength),
    );
    return { ...view, extensions: { EXT_meshopt_compression: { ...meshopt, byteOffset: offset } } };
  }
  if (view.buffer !== 0) return view;
  const start = view.byteOffset ?? 0;
  const offset = pushChunk(binary.subarray(start, start + view.byteLength));
  return { ...view, byteOffset: offset };
};

const remapAccessors = (
  accessors: readonly GltfAccessor[],
  subOffsets: ReadonlyMap<number, number>,
  viewRemap: ReadonlyMap<number, number>,
  pooledViewIdx: number,
): GltfAccessor[] =>
  accessors.map((acc) => {
    const sub = subOffsets.get(acc.bufferView);
    return sub !== undefined
      ? { ...acc, bufferView: pooledViewIdx, byteOffset: (acc.byteOffset ?? 0) + sub }
      : { ...acc, bufferView: viewRemap.get(acc.bufferView)! };
  });

const compactPooledViews = (
  views: readonly GltfBufferView[],
  poolSet: ReadonlySet<number>,
  pooledBytes: Uint8Array,
  binary: Uint8Array,
) => {
  const chunks: { readonly offset: number; readonly data: Uint8Array }[] = [];
  const nextViews: GltfBufferView[] = [];
  const viewRemap = new Map<number, number>();
  let cursor = 0;
  const pushChunk = (data: Uint8Array): number => {
    const offset = align4(cursor);
    if (data.byteLength > 0) chunks.push({ offset, data });
    cursor = offset + data.byteLength;
    return offset;
  };
  views.forEach((v, i) => {
    if (poolSet.has(i)) return;
    viewRemap.set(i, nextViews.length);
    nextViews.push(remapNonPooledView(v, binary, pushChunk));
  });
  const pooledViewIdx = nextViews.length;
  const pooledOffset = pushChunk(pooledBytes);
  nextViews.push({ buffer: 0, byteOffset: pooledOffset, byteLength: pooledBytes.byteLength });
  const nextBinary = new Uint8Array(cursor);
  for (const c of chunks) nextBinary.set(c.data, c.offset);
  return { nextViews, nextBinary, viewRemap, pooledViewIdx };
};

const excludedBufferViews = (
  document: GltfDocument,
  accessors: readonly GltfAccessor[],
): ReadonlySet<number> => {
  const excluded = new Set(
    (document.images ?? []).flatMap((im) => ('bufferView' in im ? [im.bufferView] : [])),
  );
  for (const skin of document.skins ?? []) {
    if (skin.inverseBindMatrices === undefined) continue;
    const bv = accessors[skin.inverseBindMatrices]?.bufferView;
    if (bv !== undefined) excluded.add(bv);
  }
  return excluded;
};

export const poolUncompressedBufferViews = (
  document: GltfDocument,
  binary: Uint8Array,
): { readonly document: GltfDocument; readonly binary: Uint8Array } => {
  const views = document.bufferViews;
  const accessors = document.accessors;
  if (!views || !accessors || views.length < 2) return { document, binary };
  const excluded = excludedBufferViews(document, accessors);
  const poolable = views.flatMap((v, i) => (isPoolableBufferView(v, i, excluded) ? [i] : []));
  if (poolable.length < 2) return { document, binary };

  const pooled = buildPooledBytes(views, poolable, binary);
  const compacted = compactPooledViews(views, new Set(poolable), pooled.bytes, binary);
  const nextImages = document.images?.map((im) =>
    'bufferView' in im ? { ...im, bufferView: compacted.viewRemap.get(im.bufferView)! } : im,
  );
  return {
    binary: compacted.nextBinary,
    document: {
      ...document,
      buffers: document.buffers?.map((b, i) =>
        i === 0 ? { ...b, byteLength: compacted.nextBinary.byteLength } : b,
      ),
      bufferViews: compacted.nextViews,
      accessors: remapAccessors(
        accessors,
        pooled.subOffsets,
        compacted.viewRemap,
        compacted.pooledViewIdx,
      ),
      ...(nextImages ? { images: nextImages } : {}),
    },
  };
};
