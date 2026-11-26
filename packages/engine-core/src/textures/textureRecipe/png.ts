import { sha256ByteDigest } from '../../provenance/digest';
import { zlibDeflateFixed } from './pngDeflate';
import {
  assertCanonicalTextureRaster,
  canonicalRgbaBackingBuffer,
  isCanonicalByteView,
  type CanonicalTextureRaster,
} from './raster';

const INDEXED_MIN_PIXELS = 2048;

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 0 ? crc >>> 1 : (crc >>> 1) ^ 0xedb88320;
  }
  return crc >>> 0;
});

const crc32 = (bytes: Uint8Array, start: number, end: number): number => {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[index]!) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const writePngChunk = (
  bytes: Uint8Array,
  view: DataView,
  offset: number,
  type: string,
  payload: Uint8Array,
): number => {
  view.setUint32(offset, payload.length);
  for (let i = 0; i < 4; i += 1) bytes[offset + 4 + i] = type.charCodeAt(i);
  bytes.set(payload, offset + 8);
  view.setUint32(
    offset + 8 + payload.length,
    crc32(bytes, offset + 4, offset + 8 + payload.length),
  );
  return offset + 12 + payload.length;
};

const filterSubScanlines = (
  pixels: Uint8Array,
  width: number,
  height: number,
  bpp: number,
): Uint8Array => {
  const rowBytes = width * bpp;
  const stride = rowBytes + 1;
  const out = new Uint8Array(stride * height);
  for (let row = 0; row < height; row += 1) {
    const outBase = row * stride;
    const inBase = row * rowBytes;
    out[outBase] = 1;
    for (let x = 0; x < rowBytes; x += 1) {
      const left = x >= bpp ? pixels[inBase + x - bpp]! : 0;
      out[outBase + 1 + x] = (pixels[inBase + x]! - left) & 0xff;
    }
  }
  return out;
};

interface IndexedPalette {
  readonly indices: Uint8Array;
  readonly plte: Uint8Array;
  readonly trns?: Uint8Array;
}

const collectUniqueColors = (rgba: Uint8Array, pixelCount: number): number[] | null => {
  const seen = new Set<number>();
  const colors: number[] = [];
  for (let p = 0; p < pixelCount; p += 1) {
    const base = p * 4;
    const key =
      ((rgba[base]! << 24) | (rgba[base + 1]! << 16) | (rgba[base + 2]! << 8) | rgba[base + 3]!) >>>
      0;
    if (seen.has(key)) continue;
    if (colors.length >= 256) return null;
    seen.add(key);
    colors.push(key);
  }
  return colors;
};

const buildIndexedPalette = (rgba: Uint8Array, pixelCount: number): IndexedPalette | null => {
  if (pixelCount < INDEXED_MIN_PIXELS) return null;
  const unique = collectUniqueColors(rgba, pixelCount);
  if (unique === null) return null;
  const sorted = [...unique].sort(
    (a, b) => ((a & 0xff) < 255 ? 0 : 1) - ((b & 0xff) < 255 ? 0 : 1) || a - b,
  );
  const indexByKey = new Map<number, number>(sorted.map((key, idx) => [key, idx]));
  const plte = new Uint8Array(sorted.length * 3);
  let lastAlpha = -1;
  for (let i = 0; i < sorted.length; i += 1) {
    const key = sorted[i]!;
    plte[i * 3] = (key >>> 24) & 0xff;
    plte[i * 3 + 1] = (key >>> 16) & 0xff;
    plte[i * 3 + 2] = (key >>> 8) & 0xff;
    if ((key & 0xff) < 255) lastAlpha = i;
  }
  const trns =
    lastAlpha >= 0 ? Uint8Array.from(sorted.slice(0, lastAlpha + 1), (k) => k & 0xff) : undefined;
  const indices = new Uint8Array(pixelCount);
  for (let p = 0; p < pixelCount; p += 1) {
    const base = p * 4;
    const key =
      ((rgba[base]! << 24) | (rgba[base + 1]! << 16) | (rgba[base + 2]! << 8) | rgba[base + 3]!) >>>
      0;
    indices[p] = indexByKey.get(key)!;
  }
  return { indices, plte, ...(trns ? { trns } : {}) };
};

interface CachedPngEntry {
  readonly bytes: Uint8Array;
  digest: string | undefined;
}

const pngCache = new WeakMap<CanonicalTextureRaster, CachedPngEntry>();

const isCacheableCanonicalRaster = (raster: CanonicalTextureRaster): boolean =>
  raster !== null &&
  typeof raster === 'object' &&
  Object.isFrozen(raster) &&
  Number.isSafeInteger(raster.width) &&
  Number.isSafeInteger(raster.height) &&
  raster.width > 0 &&
  raster.height > 0 &&
  raster.rgba !== null &&
  typeof raster.rgba === 'object' &&
  isCanonicalByteView(raster.rgba) &&
  raster.rgba.length === raster.width * raster.height * 4;

const buildIhdrPayload = (width: number, height: number, colorType: 3 | 6): Uint8Array => {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  return ihdr;
};

const encodePngRaw = (raster: CanonicalTextureRaster): Uint8Array => {
  const rgba = canonicalRgbaBackingBuffer(raster.rgba) ?? raster.rgba.copy();
  const palette = buildIndexedPalette(rgba, raster.width * raster.height);
  const idat = zlibDeflateFixed(
    palette
      ? filterSubScanlines(palette.indices, raster.width, raster.height, 1)
      : filterSubScanlines(rgba, raster.width, raster.height, 4),
  );
  const ihdr = buildIhdrPayload(raster.width, raster.height, palette ? 3 : 6);
  const chunksLen =
    12 +
    ihdr.length +
    (palette ? 12 + palette.plte.length : 0) +
    (palette?.trns ? 12 + palette.trns.length : 0) +
    12 +
    idat.length +
    12;
  const bytes = new Uint8Array(8 + chunksLen);
  const view = new DataView(bytes.buffer);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = writePngChunk(bytes, view, 8, 'IHDR', ihdr);
  if (palette) {
    offset = writePngChunk(bytes, view, offset, 'PLTE', palette.plte);
    if (palette.trns) offset = writePngChunk(bytes, view, offset, 'tRNS', palette.trns);
  }
  offset = writePngChunk(bytes, view, offset, 'IDAT', idat);
  writePngChunk(bytes, view, offset, 'IEND', new Uint8Array(0));
  return bytes;
};

const getOrEncodeCachedPng = (raster: CanonicalTextureRaster): CachedPngEntry => {
  let entry = pngCache.get(raster);
  if (entry === undefined) {
    assertCanonicalTextureRaster(raster);
    entry = { bytes: encodePngRaw(raster), digest: undefined };
    pngCache.set(raster, entry);
  }
  return entry;
};

/** Emits a deterministic Filter-1 (Sub) + Fixed-Huffman DEFLATE PNG (indexed <=256 colors or RGBA8). */
export const encodeCanonicalPng = (raster: CanonicalTextureRaster): Uint8Array => {
  if (isCacheableCanonicalRaster(raster)) {
    return getOrEncodeCachedPng(raster).bytes.slice();
  }
  assertCanonicalTextureRaster(raster);
  return encodePngRaw(raster);
};

/** Encode canonical PNG once and return non-aliasing bytes + SHA-256 digest. */
export const encodeCanonicalPngWithDigest = (
  raster: CanonicalTextureRaster,
): Readonly<{ readonly bytes: Uint8Array; readonly digest: string }> => {
  if (isCacheableCanonicalRaster(raster)) {
    const entry = getOrEncodeCachedPng(raster);
    if (entry.digest === undefined) entry.digest = sha256ByteDigest(entry.bytes);
    return { bytes: entry.bytes.slice(), digest: entry.digest };
  }
  assertCanonicalTextureRaster(raster);
  const bytes = encodePngRaw(raster);
  return { bytes, digest: sha256ByteDigest(bytes) };
};

/** Encode canonical PNG once and return byte length + SHA-256 digest without copying bytes. */
export const encodeCanonicalPngSummary = (
  raster: CanonicalTextureRaster,
): Readonly<{ readonly byteLength: number; readonly contentHash: string }> => {
  if (isCacheableCanonicalRaster(raster)) {
    const entry = getOrEncodeCachedPng(raster);
    if (entry.digest === undefined) entry.digest = sha256ByteDigest(entry.bytes);
    return { byteLength: entry.bytes.length, contentHash: entry.digest };
  }
  assertCanonicalTextureRaster(raster);
  const bytes = encodePngRaw(raster);
  return { byteLength: bytes.length, contentHash: sha256ByteDigest(bytes) };
};

export const canonicalRgbaDigest = (raster: CanonicalTextureRaster): string => {
  assertCanonicalTextureRaster(raster);
  return sha256ByteDigest(canonicalRgbaBackingBuffer(raster.rgba) ?? raster.rgba.copy());
};

export const canonicalPngDigest = (png: ArrayLike<number>): string => sha256ByteDigest(png);
