const WINDOW_SIZE = 32768;
const WINDOW_MASK = WINDOW_SIZE - 1;
const MIN_MATCH = 3;
const MAX_MATCH = 258;
const MAX_CHAIN = 64;
const ADLER_MOD = 65521;
const ADLER_NMAX = 5552;

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

const reverseBits = (value: number, bits: number): number => {
  let reversed = 0;
  for (let bit = 0; bit < bits; bit += 1) {
    reversed = (reversed << 1) | ((value >>> bit) & 1);
  }
  return reversed;
};

const buildFixedLitTables = () => {
  const code = new Uint16Array(286);
  const bits = new Uint8Array(286);
  for (let i = 0; i <= 143; i += 1) {
    code[i] = reverseBits(0x30 + i, 8);
    bits[i] = 8;
  }
  for (let i = 144; i <= 255; i += 1) {
    code[i] = reverseBits(0x190 + (i - 144), 9);
    bits[i] = 9;
  }
  for (let i = 256; i <= 279; i += 1) {
    code[i] = reverseBits(i - 256, 7);
    bits[i] = 7;
  }
  for (let i = 280; i <= 285; i += 1) {
    code[i] = reverseBits(0xc0 + (i - 280), 8);
    bits[i] = 8;
  }
  return { code, bits };
};

const buildLengthTables = () => {
  const sym = new Uint16Array(259);
  const extVal = new Uint16Array(259);
  const extBits = new Uint8Array(259);
  for (let idx = 0; idx < LEN_BASE.length; idx += 1) {
    const base = LEN_BASE[idx]!;
    const extra = LEN_EXTRA[idx]!;
    const count = idx === LEN_BASE.length - 1 ? 1 : 1 << extra;
    for (let delta = 0; delta < count; delta += 1) {
      const length = base + delta;
      sym[length] = 257 + idx;
      extVal[length] = delta;
      extBits[length] = extra;
    }
  }
  return { sym, extVal, extBits };
};

const buildDistanceTables = () => {
  const code = new Uint8Array(30);
  for (let i = 0; i < 30; i += 1) code[i] = reverseBits(i, 5);
  const low = new Uint8Array(257);
  const high = new Uint8Array(257);
  for (let idx = 0; idx < 16; idx += 1) {
    const base = DIST_BASE[idx]!;
    const count = 1 << DIST_EXTRA[idx]!;
    for (let d = 0; d < count; d += 1) low[base + d] = idx;
  }
  for (let idx = 16; idx < 30; idx += 1) {
    const start = (DIST_BASE[idx]! - 1) >>> 7;
    const end = (DIST_BASE[idx]! + (1 << DIST_EXTRA[idx]!) - 2) >>> 7;
    for (let slot = start; slot <= end; slot += 1) high[slot] = idx;
  }
  return { code, low, high };
};

const FIXED_LIT = buildFixedLitTables();
const LEN_TABLE = buildLengthTables();
const DIST_TABLE = buildDistanceTables();

class BitWriter {
  private buf: Uint8Array;
  private bytePos = 0;
  private bitBuf = 0;
  private bitCount = 0;

  constructor(initialCapacity: number) {
    this.buf = new Uint8Array(Math.max(64, initialCapacity));
  }

  private pushByte(byte: number): void {
    if (this.bytePos >= this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.bytePos++] = byte;
  }

  writeBits(value: number, count: number): void {
    this.bitBuf |= value << this.bitCount;
    this.bitCount += count;
    while (this.bitCount >= 8) {
      this.pushByte(this.bitBuf & 0xff);
      this.bitBuf >>>= 8;
      this.bitCount -= 8;
    }
  }

  finish(): Uint8Array {
    if (this.bitCount > 0) {
      this.pushByte(this.bitBuf & 0xff);
      this.bitBuf = 0;
      this.bitCount = 0;
    }
    return this.buf.subarray(0, this.bytePos);
  }
}

export const computeAdler32 = (bytes: Uint8Array): number => {
  let s1 = 1;
  let s2 = 0;
  let index = 0;
  while (index < bytes.length) {
    const chunkEnd = Math.min(bytes.length, index + ADLER_NMAX);
    while (index < chunkEnd) {
      s1 += bytes[index++]!;
      s2 += s1;
    }
    s1 %= ADLER_MOD;
    s2 %= ADLER_MOD;
  }
  return ((s2 << 16) | s1) >>> 0;
};

const hash3 = (data: Uint8Array, pos: number): number =>
  ((data[pos]! << 10) ^ (data[pos + 1]! << 5) ^ data[pos + 2]!) & 0x7fff;

const insertHash = (data: Uint8Array, pos: number, head: Int32Array, prev: Int32Array): void => {
  if (pos + 2 >= data.length) return;
  const h = hash3(data, pos);
  prev[pos & WINDOW_MASK] = head[h]!;
  head[h] = pos;
};

const matchLengthAt = (data: Uint8Array, left: number, right: number, maxLen: number): number => {
  let len = 0;
  while (len < maxLen && data[left + len] === data[right + len]) len += 1;
  return len;
};

const tryCandidateMatch = (
  data: Uint8Array,
  cand: number,
  pos: number,
  maxLen: number,
  bestLen: number,
): number => {
  if (cand >= pos || data[cand + bestLen] !== data[pos + bestLen]) return 0;
  const len = matchLengthAt(data, cand, pos, maxLen);
  return len > bestLen ? len : 0;
};

const findBestMatch = (
  data: Uint8Array,
  pos: number,
  head: Int32Array,
  prev: Int32Array,
): { length: number; distance: number } => {
  if (pos + MIN_MATCH > data.length) return { length: 0, distance: 0 };
  const maxLen = Math.min(MAX_MATCH, data.length - pos);
  let cand = head[hash3(data, pos)]!;
  let bestLen = MIN_MATCH - 1;
  let bestDist = 0;
  for (let steps = 0; steps < MAX_CHAIN && cand >= 0; steps += 1) {
    const dist = pos - cand;
    if (dist > WINDOW_SIZE) break;
    const len = tryCandidateMatch(data, cand, pos, maxLen, bestLen);
    if (len > 0) {
      bestLen = len;
      bestDist = dist;
      if (len === maxLen) break;
    }
    cand = prev[cand & WINDOW_MASK]!;
  }
  return bestLen >= MIN_MATCH
    ? { length: bestLen, distance: bestDist }
    : { length: 0, distance: 0 };
};

const writeLiteral = (writer: BitWriter, byte: number): void => {
  writer.writeBits(FIXED_LIT.code[byte]!, FIXED_LIT.bits[byte]!);
};

const writeMatch = (writer: BitWriter, length: number, distance: number): void => {
  const sym = LEN_TABLE.sym[length]!;
  writer.writeBits(FIXED_LIT.code[sym]!, FIXED_LIT.bits[sym]!);
  const lExtra = LEN_TABLE.extBits[length]!;
  if (lExtra > 0) writer.writeBits(LEN_TABLE.extVal[length]!, lExtra);
  const dIdx = distance <= 256 ? DIST_TABLE.low[distance]! : DIST_TABLE.high[(distance - 1) >>> 7]!;
  writer.writeBits(DIST_TABLE.code[dIdx]!, 5);
  const dExtra = DIST_EXTRA[dIdx]!;
  if (dExtra > 0) writer.writeBits(distance - DIST_BASE[dIdx]!, dExtra);
};

const deflateFixedHuffman = (data: Uint8Array): Uint8Array => {
  const writer = new BitWriter(data.length + 16);
  // BFINAL = 1, BTYPE = 01 (Fixed Huffman) -> LSB-first bits 0b011 = 3.
  writer.writeBits(3, 3);
  const head = new Int32Array(32768).fill(-1);
  const prev = new Int32Array(WINDOW_SIZE).fill(-1);
  let pos = 0;
  while (pos < data.length) {
    const match = findBestMatch(data, pos, head, prev);
    insertHash(data, pos, head, prev);
    if (match.length < MIN_MATCH) {
      writeLiteral(writer, data[pos++]!);
      continue;
    }
    if (match.length < MAX_MATCH && pos + 1 + MIN_MATCH <= data.length) {
      const next = findBestMatch(data, pos + 1, head, prev);
      if (next.length > match.length) {
        writeLiteral(writer, data[pos++]!);
        continue;
      }
    }
    writeMatch(writer, match.length, match.distance);
    const end = pos + match.length;
    for (let p = pos + 1; p < end; p += 1) insertHash(data, p, head, prev);
    pos = end;
  }
  writer.writeBits(FIXED_LIT.code[256]!, FIXED_LIT.bits[256]!);
  return writer.finish();
};

/** Encodes raw PNG scanline bytes into a deterministic zlib/Fixed-Huffman DEFLATE stream. */
export const zlibDeflateFixed = (scanlines: Uint8Array): Uint8Array => {
  const compressed = deflateFixedHuffman(scanlines);
  const adler = computeAdler32(scanlines);
  const out = new Uint8Array(2 + compressed.length + 4);
  out[0] = 0x78;
  out[1] = 0x9c;
  out.set(compressed, 2);
  const tail = 2 + compressed.length;
  out[tail] = (adler >>> 24) & 0xff;
  out[tail + 1] = (adler >>> 16) & 0xff;
  out[tail + 2] = (adler >>> 8) & 0xff;
  out[tail + 3] = adler & 0xff;
  return out;
};
