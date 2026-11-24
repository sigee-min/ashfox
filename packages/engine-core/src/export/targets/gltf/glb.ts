import type { GltfDocument } from './contract';
import { stringifyCompactDeterministicJson } from '../../json';

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const JSON_CHUNK_TYPE = 0x4e4f534a;
const BIN_CHUNK_TYPE = 0x004e4942;

const align4 = (value: number): number => (value + 3) & ~3;

const encodeUtf8 = (value: string): Uint8Array => {
  const bytes: number[] = [];
  for (const symbol of value) {
    const codePoint = symbol.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
};

const copyPadded = (
  target: Uint8Array,
  offset: number,
  source: Uint8Array,
  paddedLength: number,
  padding: number,
): void => {
  target.set(source, offset);
  target.fill(padding, offset + source.byteLength, offset + paddedLength);
};

export const buildGlb = (document: GltfDocument, binary: Uint8Array): Uint8Array => {
  const json = encodeUtf8(stringifyCompactDeterministicJson(document));
  const jsonLength = align4(json.byteLength);
  const binaryLength = align4(binary.byteLength);
  const totalLength = 12 + 8 + jsonLength + (binaryLength > 0 ? 8 + binaryLength : 0);
  const result = new Uint8Array(totalLength);
  const view = new DataView(result.buffer);

  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, GLB_VERSION, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, JSON_CHUNK_TYPE, true);
  copyPadded(result, 20, json, jsonLength, 0x20);

  if (binaryLength > 0) {
    const chunkOffset = 20 + jsonLength;
    view.setUint32(chunkOffset, binaryLength, true);
    view.setUint32(chunkOffset + 4, BIN_CHUNK_TYPE, true);
    copyPadded(result, chunkOffset + 8, binary, binaryLength, 0);
  }

  return result;
};
