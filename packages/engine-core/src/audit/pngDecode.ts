import { decodeBase64Bytes } from '../textures/textureRecipe/base64';

export interface DecodedPngRgba {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

interface HuffTable {
  readonly maxBits: number;
  readonly counts: Uint16Array;
  readonly symbols: Uint16Array;
}

interface BitReader {
  readonly data: Uint8Array;
  pos: number;
  bitBuf: number;
  bitCount: number;
}

const LEN_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];
const LEN_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

const buildHuff = (lengths: Uint8Array): HuffTable => {
  const maxBits = lengths.reduce((m, l) => Math.max(m, l), 0);
  const counts = new Uint16Array(maxBits + 1);
  for (const l of lengths) if (l > 0) counts[l]! += 1;
  const offsets = new Uint16Array(maxBits + 1);
  for (let b = 1; b < maxBits; b += 1) offsets[b + 1] = offsets[b]! + counts[b]!;
  const symbols = new Uint16Array(lengths.length);
  for (let s = 0; s < lengths.length; s += 1) {
    const l = lengths[s]!;
    if (l > 0) symbols[offsets[l]!++] = s;
  }
  return { maxBits, counts, symbols };
};

const FIXED_LIT = (() => {
  const lens = new Uint8Array(288);
  lens.fill(8, 0, 144);
  lens.fill(9, 144, 256);
  lens.fill(7, 256, 280);
  lens.fill(8, 280, 288);
  return buildHuff(lens);
})();

const FIXED_DIST = buildHuff(new Uint8Array(32).fill(5));

const readBit = (r: BitReader): number => {
  if (r.bitCount === 0) {
    if (r.pos >= r.data.length) throw new Error('Unexpected end of DEFLATE stream.');
    r.bitBuf = r.data[r.pos++]!;
    r.bitCount = 8;
  }
  const bit = r.bitBuf & 1;
  r.bitBuf >>>= 1;
  r.bitCount -= 1;
  return bit;
};

const readBits = (r: BitReader, count: number): number => {
  let out = 0;
  for (let i = 0; i < count; i += 1) out |= readBit(r) << i;
  return out;
};

const decodeSym = (r: BitReader, h: HuffTable): number => {
  let code = 0;
  let first = 0;
  let idx = 0;
  for (let len = 1; len <= h.maxBits; len += 1) {
    code |= readBit(r);
    const count = h.counts[len]!;
    if (code - count < first) return h.symbols[idx + (code - first)]!;
    idx += count;
    first = (first + count) << 1;
    code <<= 1;
  }
  throw new Error('Invalid DEFLATE Huffman symbol.');
};

const readDynamicTables = (r: BitReader): { readonly lit: HuffTable; readonly dist: HuffTable } => {
  const hlit = readBits(r, 5) + 257;
  const hdist = readBits(r, 5) + 1;
  const hclen = readBits(r, 4) + 4;
  const clLens = new Uint8Array(19);
  for (let i = 0; i < hclen; i += 1) clLens[CL_ORDER[i]!] = readBits(r, 3);
  const clTree = buildHuff(clLens);
  const combined = new Uint8Array(hlit + hdist);
  let i = 0;
  while (i < combined.length) {
    const sym = decodeSym(r, clTree);
    if (sym < 16) {
      combined[i++] = sym;
      continue;
    }
    const repeat =
      sym === 16 ? 3 + readBits(r, 2) : sym === 17 ? 3 + readBits(r, 3) : 11 + readBits(r, 7);
    const val = sym === 16 ? combined[i - 1]! : 0;
    combined.fill(val, i, Math.min(combined.length, i + repeat));
    i += repeat;
  }
  return { lit: buildHuff(combined.subarray(0, hlit)), dist: buildHuff(combined.subarray(hlit)) };
};

const appendByte = (buf: { data: Uint8Array; len: number }, byte: number): void => {
  if (buf.len >= buf.data.length) {
    const next = new Uint8Array(buf.data.length * 2);
    next.set(buf.data);
    buf.data = next;
  }
  buf.data[buf.len++] = byte;
};

const inflateHuffmanBlock = (
  r: BitReader,
  lit: HuffTable,
  dist: HuffTable,
  out: { data: Uint8Array; len: number },
): void => {
  while (true) {
    const sym = decodeSym(r, lit);
    if (sym === 256) break;
    if (sym < 256) {
      appendByte(out, sym);
      continue;
    }
    const lenIdx = sym - 257;
    const length = LEN_BASE[lenIdx]! + readBits(r, LEN_EXTRA[lenIdx]!);
    const dSym = decodeSym(r, dist);
    const distance = DIST_BASE[dSym]! + readBits(r, DIST_EXTRA[dSym]!);
    for (let k = 0; k < length; k += 1) appendByte(out, out.data[out.len - distance]!);
  }
};

const inflateStoredBlock = (r: BitReader, out: { data: Uint8Array; len: number }): void => {
  r.bitBuf = 0;
  r.bitCount = 0;
  const len = r.data[r.pos]! | (r.data[r.pos + 1]! << 8);
  r.pos += 4;
  for (let i = 0; i < len; i += 1) appendByte(out, r.data[r.pos++]!);
};

const inflateZlib = (zlib: Uint8Array): Uint8Array => {
  const reader: BitReader = { data: zlib, pos: 2, bitBuf: 0, bitCount: 0 };
  const out = { data: new Uint8Array(1024), len: 0 };
  let final = 0;
  while (final === 0) {
    final = readBit(reader);
    const btype = readBits(reader, 2);
    if (btype === 0) inflateStoredBlock(reader, out);
    else if (btype === 1) inflateHuffmanBlock(reader, FIXED_LIT, FIXED_DIST, out);
    else if (btype === 2) {
      const trees = readDynamicTables(reader);
      inflateHuffmanBlock(reader, trees.lit, trees.dist, out);
    } else throw new Error('Unsupported DEFLATE block type.');
  }
  return out.data.subarray(0, out.len);
};

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

const filterPred = (filter: number, a: number, b: number, c: number): number => {
  if (filter === 1) return a;
  if (filter === 2) return b;
  if (filter === 3) return (a + b) >> 1;
  if (filter === 4) return paeth(a, b, c);
  return 0;
};

const unfilterRow = (
  filter: number,
  raw: Uint8Array,
  inBase: number,
  out: Uint8Array,
  outBase: number,
  rowBytes: number,
  bpp: number,
): void => {
  const hasPrev = outBase >= rowBytes;
  for (let x = 0; x < rowBytes; x += 1) {
    const a = x >= bpp ? out[outBase + x - bpp]! : 0;
    const b = hasPrev ? out[outBase - rowBytes + x]! : 0;
    const c = x >= bpp && hasPrev ? out[outBase - rowBytes + x - bpp]! : 0;
    out[outBase + x] = (raw[inBase + x]! + filterPred(filter, a, b, c)) & 0xff;
  }
};

const parsePngChunks = (bytes: Uint8Array) => {
  if (bytes.length < 33 || bytes[0] !== 137 || bytes[1] !== 80) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let colorType = 0;
  let plte: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idatParts: Uint8Array[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const len = view.getUint32(offset);
    const kind = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    );
    const payload = bytes.subarray(offset + 8, offset + 8 + len);
    if (kind === 'IHDR' && len === 13) {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      colorType = payload[9]!;
    } else if (kind === 'PLTE') plte = payload;
    else if (kind === 'tRNS') trns = payload;
    else if (kind === 'IDAT') idatParts.push(payload);
    else if (kind === 'IEND') break;
    offset += 12 + len;
  }
  return { width, height, colorType, plte, trns, idatParts };
};

const expandPixelsToRgba = (
  unfiltered: Uint8Array,
  width: number,
  height: number,
  colorType: number,
  plte: Uint8Array | null,
  trns: Uint8Array | null,
): Uint8Array | null => {
  const total = width * height;
  if (colorType === 6) return unfiltered;
  const rgba = new Uint8Array(total * 4);
  if (colorType === 2) {
    for (let i = 0; i < total; i += 1) {
      rgba[i * 4] = unfiltered[i * 3]!;
      rgba[i * 4 + 1] = unfiltered[i * 3 + 1]!;
      rgba[i * 4 + 2] = unfiltered[i * 3 + 2]!;
      rgba[i * 4 + 3] = 255;
    }
    return rgba;
  }
  if (colorType === 3 && plte) {
    for (let i = 0; i < total; i += 1) {
      const idx = unfiltered[i]!;
      rgba[i * 4] = plte[idx * 3] ?? 0;
      rgba[i * 4 + 1] = plte[idx * 3 + 1] ?? 0;
      rgba[i * 4 + 2] = plte[idx * 3 + 2] ?? 0;
      rgba[i * 4 + 3] = trns && idx < trns.length ? trns[idx]! : 255;
    }
    return rgba;
  }
  return null;
};

/** Decode a base64 PNG payload into RGBA8 pixels, or null if malformed/unsupported. */
export const decodePngBase64Rgba = (base64: string): DecodedPngRgba | null => {
  try {
    const parsed = parsePngChunks(decodeBase64Bytes(base64));
    if (!parsed || parsed.width <= 0 || parsed.height <= 0 || parsed.idatParts.length === 0) {
      return null;
    }
    const bpp =
      parsed.colorType === 6 ? 4 : parsed.colorType === 2 ? 3 : parsed.colorType === 3 ? 1 : 0;
    if (bpp === 0) return null;
    const totalLen = parsed.idatParts.reduce((s, p) => s + p.length, 0);
    const idat = new Uint8Array(totalLen);
    let pos = 0;
    for (const part of parsed.idatParts) {
      idat.set(part, pos);
      pos += part.length;
    }
    const raw = inflateZlib(idat);
    const rowBytes = parsed.width * bpp;
    if (raw.length < (rowBytes + 1) * parsed.height) return null;
    const unfiltered = new Uint8Array(rowBytes * parsed.height);
    for (let y = 0; y < parsed.height; y += 1) {
      unfilterRow(
        raw[y * (rowBytes + 1)]!,
        raw,
        y * (rowBytes + 1) + 1,
        unfiltered,
        y * rowBytes,
        rowBytes,
        bpp,
      );
    }
    const rgba = expandPixelsToRgba(
      unfiltered,
      parsed.width,
      parsed.height,
      parsed.colorType,
      parsed.plte,
      parsed.trns,
    );
    return rgba ? { width: parsed.width, height: parsed.height, rgba } : null;
  } catch {
    return null;
  }
};
