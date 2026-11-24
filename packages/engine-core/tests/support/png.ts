import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

/**
 * Test-owned PNG decoder used by engine-core raster assertions.
 *
 * Corpus artifact receipt validation remains script-owned; this decoder keeps
 * engine tests independent from the script-side artifact parser.
 */
const invariant = (condition: boolean, message: string): void => {
  if (!condition) throw new TypeError(message);
};

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

export const parsePng = (bytes: Buffer, label: string) => {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  invariant(bytes.subarray(0, 8).equals(signature), `${label} is not a PNG.`);
  let offset = 8;
  let width = 0;
  let height = 0;
  let sawHeader = false;
  let sawData = false;
  let sawEnd = false;
  const dataChunks = [];
  while (offset < bytes.length) {
    invariant(offset + 12 <= bytes.length, `${label} contains a truncated PNG chunk.`);
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    invariant(
      dataEnd + 4 <= bytes.length,
      `${label} contains a PNG chunk outside the byte stream.`,
    );
    const data = bytes.subarray(dataStart, dataEnd);
    const expectedCrc = bytes.readUInt32BE(dataEnd);
    invariant(
      expectedCrc === crc32(Buffer.concat([type, data])),
      `${label} contains a PNG chunk with an invalid CRC.`,
    );
    const name = type.toString('ascii');
    if (!sawHeader) {
      invariant(name === 'IHDR' && length === 13, `${label} must begin with an IHDR chunk.`);
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      invariant(width > 0 && height > 0, `${label} has invalid PNG dimensions.`);
      invariant(data[8] === 8 && data[9] === 6, `${label} must be an 8-bit RGBA PNG.`);
      sawHeader = true;
    } else if (name === 'IDAT') {
      invariant(!sawEnd && length > 0, `${label} contains an invalid IDAT chunk.`);
      sawData = true;
      dataChunks.push(data);
    } else if (name === 'IEND') {
      invariant(sawData && length === 0 && !sawEnd, `${label} contains an invalid IEND chunk.`);
      sawEnd = true;
    } else {
      invariant(!sawEnd, `${label} contains data after IEND.`);
    }
    offset = dataEnd + 4;
    if (sawEnd) invariant(offset === bytes.length, `${label} contains trailing bytes after IEND.`);
  }
  invariant(
    sawHeader && sawData && sawEnd,
    `${label} is missing a complete IHDR/IDAT/IEND sequence.`,
  );
  const rowBytes = width * 4;
  const decoded = inflateSync(Buffer.concat(dataChunks));
  invariant(
    decoded.length === (rowBytes + 1) * height,
    `${label} has an invalid RGBA scanline length.`,
  );
  let transparentPixelCount = 0;
  let opaquePixelCount = 0;
  const rgba = Buffer.alloc(rowBytes * height);
  const alpha = Buffer.alloc(width * height);
  let previous = Buffer.alloc(rowBytes);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (rowBytes + 1);
    const filter = decoded[rowStart];
    invariant(filter <= 4, `${label} uses an unsupported PNG filter.`);
    const row = Buffer.alloc(rowBytes);
    for (let index = 0; index < rowBytes; index += 1) {
      const left = index >= 4 ? row[index - 4] : 0;
      const up = previous[index] ?? 0;
      const upperLeft = index >= 4 ? (previous[index - 4] ?? 0) : 0;
      const filtered = decoded[rowStart + index + 1];
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? Math.floor((left + up) / 2)
                : Math.abs(left - up) <= Math.abs(up - upperLeft) &&
                    Math.abs(left - up) <= Math.abs(left - upperLeft)
                  ? left
                  : Math.abs(up - upperLeft) <= Math.abs(left - upperLeft)
                    ? up
                    : upperLeft;
      row[index] = (filtered + predictor) & 0xff;
    }
    row.copy(rgba, y * rowBytes);
    for (let index = 3; index < rowBytes; index += 4) {
      const alphaIndex = y * width + Math.floor(index / 4);
      alpha[alphaIndex] = row[index];
      if (row[index] === 0) transparentPixelCount += 1;
      else opaquePixelCount += 1;
    }
    previous = row;
  }
  const rgbaSha256 = `sha256:${createHash('sha256').update(rgba).digest('hex')}`;
  const alphaSha256 = `sha256:${createHash('sha256').update(alpha).digest('hex')}`;
  return Object.freeze({
    width,
    height,
    opaquePixelCount,
    transparentPixelCount,
    rgba,
    rgbaSha256,
    alphaSha256,
  });
};
