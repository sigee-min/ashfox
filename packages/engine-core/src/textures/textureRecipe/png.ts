import { sha256ByteDigest } from '../../provenance/digest';
import {
  assertCanonicalTextureRaster,
  canonicalRgbaBackingBuffer,
  isCanonicalByteView,
  type CanonicalTextureRaster,
} from './raster';

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

const beginPngChunk = (
  bytes: Uint8Array,
  view: DataView,
  offset: number,
  type: string,
  length: number,
): number => {
  view.setUint32(offset, length);
  for (let index = 0; index < 4; index += 1) bytes[offset + 4 + index] = type.charCodeAt(index);
  return offset + 8;
};

const endPngChunk = (bytes: Uint8Array, view: DataView, offset: number, length: number): void => {
  view.setUint32(offset + 8 + length, crc32(bytes, offset + 4, offset + 8 + length));
};

interface StoredDeflateState {
  output: number;
  pixel: number;
  column: number;
  first: number;
  second: number;
  adlerCount: number;
}

const writeStoredDeflateBlock = (
  bytes: Uint8Array,
  raster: CanonicalTextureRaster,
  backing: Uint8Array | undefined,
  stride: number,
  length: number,
  state: StoredDeflateState,
): void => {
  for (let index = 0; index < length; index += 1) {
    const byte =
      state.column === 0
        ? 0
        : backing !== undefined
          ? backing[state.pixel++]!
          : raster.rgba.at(state.pixel++)!;
    bytes[state.output++] = byte;
    if (++state.column === stride) state.column = 0;
    state.first += byte;
    state.second += state.first;
    // zlib's NMAX keeps both sums bounded without per-byte division.
    if (++state.adlerCount === 5552) {
      state.first %= 65521;
      state.second %= 65521;
      state.adlerCount = 0;
    }
  }
};

const writeStoredDeflateIdat = (
  bytes: Uint8Array,
  view: DataView,
  raster: CanonicalTextureRaster,
  stride: number,
  scanlineLength: number,
  compressedLength: number,
): void => {
  let output = beginPngChunk(bytes, view, 33, 'IDAT', compressedLength);
  bytes[output++] = 0x78;
  bytes[output++] = 0x01;
  const backing = canonicalRgbaBackingBuffer(raster.rgba);
  const state: StoredDeflateState = {
    output,
    pixel: 0,
    column: 0,
    first: 1,
    second: 0,
    adlerCount: 0,
  };
  for (let offset = 0; offset < scanlineLength;) {
    const length = Math.min(65535, scanlineLength - offset);
    bytes[state.output++] = offset + length === scanlineLength ? 1 : 0;
    view.setUint16(state.output, length, true);
    view.setUint16(state.output + 2, ~length & 0xffff, true);
    state.output += 4;
    writeStoredDeflateBlock(bytes, raster, backing, stride, length, state);
    offset += length;
  }
  view.setUint32(state.output, (((state.second % 65521) << 16) | (state.first % 65521)) >>> 0);
  endPngChunk(bytes, view, 33, compressedLength);
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

const encodePngRaw = (raster: CanonicalTextureRaster): Uint8Array => {
  const stride = raster.width * 4 + 1;
  const scanlineLength = stride * raster.height;
  const compressedLength = 2 + 5 * Math.ceil(scanlineLength / 65535) + scanlineLength + 4;
  const bytes = new Uint8Array(57 + compressedLength);
  const view = new DataView(bytes.buffer);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = beginPngChunk(bytes, view, 8, 'IHDR', 13);
  view.setUint32(header, raster.width);
  view.setUint32(header + 4, raster.height);
  bytes.set([8, 6, 0, 0, 0], header + 8);
  endPngChunk(bytes, view, 8, 13);
  writeStoredDeflateIdat(bytes, view, raster, stride, scanlineLength, compressedLength);
  beginPngChunk(bytes, view, 45 + compressedLength, 'IEND', 0);
  endPngChunk(bytes, view, 45 + compressedLength, 0);
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

/** Emits the canonical filter-0/stored-DEFLATE RGBA8 PNG directly into its
 * exact final buffer. No full-size scanline, compressed or chunk copies. */
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
