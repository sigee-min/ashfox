import { sha256ByteDigest } from '../../provenance/digest';
import {
  assertCanonicalTextureRaster,
  type CanonicalTextureRaster
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

/** Emits the canonical filter-0/stored-DEFLATE RGBA8 PNG directly into its
 * exact final buffer. No full-size scanline, compressed or chunk copies. */
export const encodeCanonicalPng = (
  raster: CanonicalTextureRaster
): Uint8Array => {
  assertCanonicalTextureRaster(raster);
  const stride = raster.width * 4 + 1;
  const scanlineLength = stride * raster.height;
  const compressedLength = 2 + 5 * Math.ceil(scanlineLength / 65535) + scanlineLength + 4;
  const bytes = new Uint8Array(57 + compressedLength);
  const view = new DataView(bytes.buffer);
  const beginChunk = (offset: number, type: string, length: number): number => {
    view.setUint32(offset, length);
    for (let index = 0; index < 4; index += 1) bytes[offset + 4 + index] = type.charCodeAt(index);
    return offset + 8;
  };
  const endChunk = (offset: number, length: number): void => {
    view.setUint32(offset + 8 + length, crc32(bytes, offset + 4, offset + 8 + length));
  };
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = beginChunk(8, 'IHDR', 13);
  view.setUint32(header, raster.width);
  view.setUint32(header + 4, raster.height);
  bytes.set([8, 6, 0, 0, 0], header + 8);
  endChunk(8, 13);

  let output = beginChunk(33, 'IDAT', compressedLength);
  bytes[output++] = 0x78;
  bytes[output++] = 0x01;
  let pixel = 0, column = 0, first = 1, second = 0, adlerCount = 0;
  for (let offset = 0; offset < scanlineLength;) {
    const length = Math.min(65535, scanlineLength - offset);
    bytes[output++] = offset + length === scanlineLength ? 1 : 0;
    view.setUint16(output, length, true);
    view.setUint16(output + 2, (~length) & 0xffff, true);
    output += 4;
    for (let index = 0; index < length; index += 1) {
      const byte = column === 0 ? 0 : raster.rgba.at(pixel++)!;
      bytes[output++] = byte;
      if (++column === stride) column = 0;
      first += byte;
      second += first;
      // zlib's NMAX keeps both sums bounded without per-byte division.
      if (++adlerCount === 5552) {
        first %= 65521;
        second %= 65521;
        adlerCount = 0;
      }
    }
    offset += length;
  }
  view.setUint32(output, (((second % 65521) << 16) | (first % 65521)) >>> 0);
  endChunk(33, compressedLength);
  beginChunk(45 + compressedLength, 'IEND', 0);
  endChunk(45 + compressedLength, 0);
  return bytes;
};

export const canonicalRgbaDigest = (
  raster: CanonicalTextureRaster
): string => {
  assertCanonicalTextureRaster(raster);
  return sha256ByteDigest(raster.rgba.copy());
};

export const canonicalPngDigest = (
  png: ArrayLike<number>
): string => sha256ByteDigest(png);
