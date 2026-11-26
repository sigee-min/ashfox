import { compareText, decodeUtf8, encodeUtf8 } from '@ashfox/internal-contracts';
import type { Artifact } from '../../bundle/contract';
import { digest, stable } from '../../shared/digest';

interface GlbBufferView {
  buffer?: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
  target?: number;
  extensions?: {
    EXT_meshopt_compression?: {
      buffer: number;
      byteOffset: number;
      byteLength: number;
      byteStride: number;
      count: number;
      mode: string;
      filter?: string;
    };
  };
}

interface GlbImage {
  bufferView?: number;
  uri?: string;
  mimeType?: string;
  name?: string;
}
interface GlbAccessor {
  bufferView?: number;
  sparse?: { indices?: { bufferView: number }; values?: { bufferView: number } };
}
interface GlbJson {
  buffers?: Array<{ byteLength: number; uri?: string }>;
  bufferViews?: GlbBufferView[];
  accessors?: GlbAccessor[];
  images?: GlbImage[];
}
export interface SharedTextureDedupeResult {
  readonly files: readonly Artifact[];
  readonly sharedTextures: readonly Artifact[];
}

const align4 = (value: number): number => (value + 3) & ~3;

const parseGlb = (bytes: Uint8Array): { gltf: GlbJson; binChunk: Uint8Array } | null => {
  if (bytes.byteLength < 20) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) return null;
  const total = Math.min(bytes.byteLength, view.getUint32(8, true));
  let offset = 12;
  let gltf: GlbJson | undefined;
  let binChunk: Uint8Array | undefined;
  while (offset + 8 <= total) {
    const len = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const end = offset + 8 + len;
    if (end > total) return null;
    if (type === 0x4e4f534a && !gltf)
      gltf = JSON.parse(decodeUtf8(bytes.subarray(offset + 8, end))) as GlbJson;
    else if (type === 0x004e4942 && !binChunk) binChunk = bytes.subarray(offset + 8, end);
    offset = end;
  }
  return gltf ? { gltf, binChunk: binChunk ?? new Uint8Array(0) } : null;
};

const encodeGlb = (gltf: GlbJson, binChunk: Uint8Array): Uint8Array => {
  const jsonBytes = encodeUtf8(JSON.stringify(stable(gltf)));
  const jsonLen = align4(jsonBytes.byteLength);
  const binLen = align4(binChunk.byteLength);
  const total = 12 + 8 + jsonLen + (binLen > 0 ? 8 + binLen : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLen, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.byteLength, 20 + jsonLen);
  if (binLen > 0) {
    const binStart = 20 + jsonLen;
    view.setUint32(binStart, binLen, true);
    view.setUint32(binStart + 4, 0x004e4942, true);
    out.set(binChunk, binStart + 8);
  }
  return out;
};

const relativePackUri = (glbPath: string, targetPath: string): string => {
  const slash = glbPath.lastIndexOf('/');
  if (slash < 0) return targetPath;
  return `${'../'.repeat(glbPath.slice(0, slash).split('/').length)}${targetPath}`;
};

const collectRetainedViews = (gltf: GlbJson): Set<number> => {
  const used = new Set<number>();
  for (const acc of gltf.accessors ?? []) {
    if (acc.bufferView !== undefined) used.add(acc.bufferView);
    if (acc.sparse?.indices) used.add(acc.sparse.indices.bufferView);
    if (acc.sparse?.values) used.add(acc.sparse.values.bufferView);
  }
  for (const img of gltf.images ?? []) if (img.bufferView !== undefined) used.add(img.bufferView);
  return used;
};

const appendBinSlice = (
  chunks: Uint8Array[],
  cursor: { len: number },
  slice: Uint8Array,
): number => {
  const aligned = align4(cursor.len);
  if (aligned > cursor.len) chunks.push(new Uint8Array(aligned - cursor.len));
  chunks.push(slice);
  cursor.len = aligned + slice.byteLength;
  return aligned;
};

const remapAccessorAndImageViews = (gltf: GlbJson, remap: ReadonlyMap<number, number>): void => {
  for (const acc of gltf.accessors ?? []) {
    if (acc.bufferView !== undefined) acc.bufferView = remap.get(acc.bufferView)!;
    if (acc.sparse?.indices)
      acc.sparse.indices.bufferView = remap.get(acc.sparse.indices.bufferView)!;
    if (acc.sparse?.values) acc.sparse.values.bufferView = remap.get(acc.sparse.values.bufferView)!;
  }
  for (const img of gltf.images ?? [])
    if (img.bufferView !== undefined) img.bufferView = remap.get(img.bufferView)!;
};

const compactBufferViews = (gltf: GlbJson, binChunk: Uint8Array): Uint8Array => {
  const used = collectRetainedViews(gltf);
  const remap = new Map<number, number>();
  const kept: GlbBufferView[] = [];
  const chunks: Uint8Array[] = [];
  const cursor = { len: 0 };
  (gltf.bufferViews ?? []).forEach((bv, idx) => {
    if (!used.has(idx)) return;
    remap.set(idx, kept.length);
    const meshopt = bv.extensions?.EXT_meshopt_compression;
    if (meshopt && meshopt.buffer === 0) {
      const slice = binChunk.subarray(meshopt.byteOffset, meshopt.byteOffset + meshopt.byteLength);
      kept.push({
        ...bv,
        extensions: {
          EXT_meshopt_compression: {
            ...meshopt,
            byteOffset: appendBinSlice(chunks, cursor, slice),
          },
        },
      });
    } else if ((bv.buffer ?? 0) === 0) {
      const start = bv.byteOffset ?? 0;
      kept.push({
        ...bv,
        byteOffset: appendBinSlice(chunks, cursor, binChunk.subarray(start, start + bv.byteLength)),
      });
    } else kept.push(bv);
  });
  remapAccessorAndImageViews(gltf, remap);
  if (kept.length === 0) {
    delete gltf.bufferViews;
    delete gltf.buffers;
    return new Uint8Array(0);
  }
  gltf.bufferViews = kept;
  if (gltf.buffers?.[0]) gltf.buffers[0] = { ...gltf.buffers[0], byteLength: cursor.len };
  const merged = new Uint8Array(cursor.len);
  for (let pos = 0, i = 0; i < chunks.length; pos += chunks[i]!.byteLength, i += 1)
    merged.set(chunks[i]!, pos);
  return merged;
};

const rewriteGlbImages = (file: Artifact, sharedByPath: Map<string, Uint8Array>): Artifact => {
  const parsed = parseGlb(file.bytes);
  if (!parsed || !parsed.gltf.images?.length || !parsed.gltf.bufferViews?.length) return file;
  const { gltf, binChunk } = parsed;
  let changed = false;
  gltf.images = gltf.images!.map((img) => {
    if (img.bufferView === undefined || img.mimeType !== 'image/png') return img;
    const bv = gltf.bufferViews![img.bufferView];
    if (!bv || (bv.buffer !== undefined && bv.buffer !== 0)) return img;
    const start = bv.byteOffset ?? 0;
    const pngBytes = binChunk.slice(start, start + bv.byteLength);
    const texPath = `textures/${digest(pngBytes).slice(0, 12)}.png`;
    if (!sharedByPath.has(texPath)) sharedByPath.set(texPath, pngBytes);
    changed = true;
    return {
      uri: relativePackUri(file.path, texPath),
      mimeType: 'image/png',
      ...(img.name ? { name: img.name } : {}),
    };
  });
  if (!changed) return file;
  return { path: file.path, bytes: encodeGlb(gltf, compactBufferViews(gltf, binChunk)) };
};

/** Extract and deduplicate embedded PNG textures across multi-asset GLB files. */
export const deduplicateSharedGlbTextures = (
  files: readonly Artifact[],
  enabled = true,
): SharedTextureDedupeResult => {
  if (!enabled || files.filter((f) => f.path.endsWith('.glb')).length < 2)
    return { files, sharedTextures: [] };
  const sharedByPath = new Map<string, Uint8Array>();
  const rewritten = files.map((file) =>
    file.path.endsWith('.glb') ? rewriteGlbImages(file, sharedByPath) : file,
  );
  const sharedTextures = [...sharedByPath.entries()]
    .sort(([a], [b]) => compareText(a, b))
    .map(([path, bytes]) => ({ path, bytes }));
  return { files: rewritten, sharedTextures };
};
