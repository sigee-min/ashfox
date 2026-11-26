const WINDOW_SIZE = 32768;
const WINDOW_MASK = WINDOW_SIZE - 1;
const MIN_MATCH = 3;
const MAX_MATCH = 258;
const MAX_CHAIN = 256;
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
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

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
  const bits = new Uint8Array(30).fill(5);
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
  return { code, bits, low, high };
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

interface LzToken {
  readonly sym: number;
  readonly len?: number;
  readonly dist?: number;
}

const collectLzTokens = (data: Uint8Array): LzToken[] => {
  const head = new Int32Array(32768).fill(-1);
  const prev = new Int32Array(WINDOW_SIZE).fill(-1);
  const tokens: LzToken[] = [];
  let pos = 0;
  while (pos < data.length) {
    const match = findBestMatch(data, pos, head, prev);
    insertHash(data, pos, head, prev);
    if (match.length < MIN_MATCH) {
      tokens.push({ sym: data[pos++]! });
      continue;
    }
    if (match.length < MAX_MATCH && pos + 1 + MIN_MATCH <= data.length) {
      const next = findBestMatch(data, pos + 1, head, prev);
      if (next.length > match.length) {
        tokens.push({ sym: data[pos++]! });
        continue;
      }
    }
    tokens.push({ sym: LEN_TABLE.sym[match.length]!, len: match.length, dist: match.distance });
    const end = pos + match.length;
    for (let p = pos + 1; p < end; p += 1) insertHash(data, p, head, prev);
    pos = end;
  }
  tokens.push({ sym: 256 });
  return tokens;
};

interface HuffNode {
  readonly freq: number;
  readonly sym: number;
  readonly left?: HuffNode;
  readonly right?: HuffNode;
}

const assignDepths = (node: HuffNode, depth: number, lengths: Uint8Array): void => {
  if (!node.left && !node.right) {
    lengths[node.sym] = depth;
    return;
  }
  if (node.left) assignDepths(node.left, depth + 1, lengths);
  if (node.right) assignDepths(node.right, depth + 1, lengths);
};

const clampCodeLengths = (lengths: Uint8Array, maxBits: number): void => {
  const blCount = new Uint16Array(maxBits + 1);
  let excess = -(1 << maxBits);
  const byDepth: number[] = [];
  for (let i = 0; i < lengths.length; i += 1) {
    const len = lengths[i]!;
    if (len === 0) continue;
    const clamped = Math.min(len, maxBits);
    blCount[clamped]! += 1;
    excess += 1 << (maxBits - clamped);
    byDepth.push(i);
  }
  while (excess > 0) {
    let b = maxBits - 1;
    while (b > 0 && blCount[b] === 0) b -= 1;
    if (b === 0) break;
    blCount[b]! -= 1;
    blCount[b + 1]! += 2;
    blCount[maxBits]! -= 1;
    excess -= 1;
  }
  byDepth.sort((a, b) => lengths[a]! - lengths[b]! || a - b);
  let cursor = 0;
  for (let bits = 1; bits <= maxBits; bits += 1) {
    for (let k = 0; k < blCount[bits]!; k += 1) lengths[byDepth[cursor++]!] = bits;
  }
};

const buildCodeLengths = (freqs: Uint32Array, maxBits: number): Uint8Array => {
  const lengths = new Uint8Array(freqs.length);
  const queue: HuffNode[] = [];
  for (let s = 0; s < freqs.length; s += 1) {
    if (freqs[s]! > 0) queue.push({ freq: freqs[s]!, sym: s });
  }
  if (queue.length <= 1) {
    if (queue.length === 1) lengths[queue[0]!.sym] = 1;
    return lengths;
  }
  while (queue.length > 1) {
    queue.sort((a, b) => a.freq - b.freq || a.sym - b.sym);
    const left = queue.shift()!;
    const right = queue.shift()!;
    queue.push({ freq: left.freq + right.freq, sym: Math.min(left.sym, right.sym), left, right });
  }
  assignDepths(queue[0]!, 0, lengths);
  if (lengths.some((l) => l > maxBits)) clampCodeLengths(lengths, maxBits);
  return lengths;
};

const buildCanonicalCodes = (lengths: Uint8Array, maxBits: number): Uint16Array => {
  const blCount = new Uint16Array(maxBits + 1);
  for (const l of lengths) if (l > 0) blCount[l]! += 1;
  const nextCode = new Uint16Array(maxBits + 1);
  let code = 0;
  for (let bits = 1; bits <= maxBits; bits += 1) {
    code = (code + blCount[bits - 1]!) << 1;
    nextCode[bits] = code;
  }
  const codes = new Uint16Array(lengths.length);
  for (let sym = 0; sym < lengths.length; sym += 1) {
    const len = lengths[sym]!;
    if (len > 0) codes[sym] = reverseBits(nextCode[len]!++, len);
  }
  return codes;
};

interface RleSym {
  readonly sym: number;
  readonly extraBits: number;
  readonly extra: number;
}

const pushZeroRun = (out: RleSym[], count: number): void => {
  let rem = count;
  while (rem >= 11) {
    const chunk = Math.min(rem, 138);
    out.push({ sym: 18, extraBits: 7, extra: chunk - 11 });
    rem -= chunk;
  }
  if (rem >= 3) {
    out.push({ sym: 17, extraBits: 3, extra: rem - 3 });
    rem = 0;
  }
  while (rem-- > 0) out.push({ sym: 0, extraBits: 0, extra: 0 });
};

const pushValueRun = (out: RleSym[], val: number, count: number): void => {
  out.push({ sym: val, extraBits: 0, extra: 0 });
  let rem = count - 1;
  while (rem >= 3) {
    const chunk = Math.min(rem, 6);
    out.push({ sym: 16, extraBits: 2, extra: chunk - 3 });
    rem -= chunk;
  }
  while (rem-- > 0) out.push({ sym: val, extraBits: 0, extra: 0 });
};

const rleCodeLengths = (combined: Uint8Array): RleSym[] => {
  const out: RleSym[] = [];
  let i = 0;
  while (i < combined.length) {
    const val = combined[i]!;
    let run = 1;
    while (i + run < combined.length && combined[i + run] === val) run += 1;
    if (val === 0) pushZeroRun(out, run);
    else pushValueRun(out, val, run);
    i += run;
  }
  return out;
};

const distanceCodeIndex = (dist: number): number =>
  dist <= 256 ? DIST_TABLE.low[dist]! : DIST_TABLE.high[(dist - 1) >>> 7]!;

const countTokenBits = (
  tokens: readonly LzToken[],
  litBits: Uint8Array,
  distBits: Uint8Array,
): number => {
  let total = 0;
  for (const tok of tokens) {
    total += litBits[tok.sym]!;
    if (tok.len !== undefined && tok.dist !== undefined) {
      total += LEN_TABLE.extBits[tok.len]!;
      const dIdx = distanceCodeIndex(tok.dist);
      total += distBits[dIdx]! + DIST_EXTRA[dIdx]!;
    }
  }
  return total;
};

const writeTokens = (
  writer: BitWriter,
  tokens: readonly LzToken[],
  litCode: Uint16Array,
  litBits: Uint8Array,
  distCode: Uint16Array | Uint8Array,
  distBits: Uint8Array,
): void => {
  for (const tok of tokens) {
    writer.writeBits(litCode[tok.sym]!, litBits[tok.sym]!);
    if (tok.len === undefined || tok.dist === undefined) continue;
    const lExtra = LEN_TABLE.extBits[tok.len]!;
    if (lExtra > 0) writer.writeBits(LEN_TABLE.extVal[tok.len]!, lExtra);
    const dIdx = distanceCodeIndex(tok.dist);
    writer.writeBits(distCode[dIdx]!, distBits[dIdx]!);
    const dExtra = DIST_EXTRA[dIdx]!;
    if (dExtra > 0) writer.writeBits(tok.dist - DIST_BASE[dIdx]!, dExtra);
  }
};

const trimTrailingZeros = (arr: Uint8Array, minLen: number): number => {
  let len = arr.length;
  while (len > minLen && arr[len - 1] === 0) len -= 1;
  return len;
};

const prepareDynamicTables = (tokens: readonly LzToken[]) => {
  const litFreq = new Uint32Array(286);
  const distFreq = new Uint32Array(30);
  for (const tok of tokens) {
    litFreq[tok.sym]! += 1;
    if (tok.dist !== undefined) distFreq[distanceCodeIndex(tok.dist)]! += 1;
  }
  if (distFreq.every((f) => f === 0)) distFreq[0] = 1;
  const litLen = buildCodeLengths(litFreq, 15);
  const distLen = buildCodeLengths(distFreq, 15);
  const hlit = trimTrailingZeros(litLen, 257);
  const hdist = trimTrailingZeros(distLen, 1);
  const combined = new Uint8Array(hlit + hdist);
  combined.set(litLen.subarray(0, hlit), 0);
  combined.set(distLen.subarray(0, hdist), hlit);
  const rle = rleCodeLengths(combined);
  const clFreq = new Uint32Array(19);
  for (const item of rle) clFreq[item.sym]! += 1;
  const clLen = buildCodeLengths(clFreq, 7);
  let hclen = 4;
  for (let i = CL_ORDER.length - 1; i >= 4; i -= 1) {
    if (clLen[CL_ORDER[i]!]! > 0) {
      hclen = i + 1;
      break;
    }
  }
  let headerBits = 14 + hclen * 3;
  for (const item of rle) headerBits += clLen[item.sym]! + item.extraBits;
  return { litLen, distLen, hlit, hdist, hclen, rle, clLen, headerBits };
};

const deflateDynamicOrFixed = (data: Uint8Array): Uint8Array => {
  const tokens = collectLzTokens(data);
  const fixedBits = 3 + countTokenBits(tokens, FIXED_LIT.bits, DIST_TABLE.bits);
  const dyn = prepareDynamicTables(tokens);
  const dynBits = 3 + dyn.headerBits + countTokenBits(tokens, dyn.litLen, dyn.distLen);
  const writer = new BitWriter(Math.ceil(Math.min(fixedBits, dynBits) / 8) + 8);
  if (dynBits < fixedBits) {
    // BFINAL = 1, BTYPE = 10 (Dynamic Huffman) -> LSB-first 0b101 = 5.
    writer.writeBits(5, 3);
    writer.writeBits(dyn.hlit - 257, 5);
    writer.writeBits(dyn.hdist - 1, 5);
    writer.writeBits(dyn.hclen - 4, 4);
    for (let i = 0; i < dyn.hclen; i += 1) writer.writeBits(dyn.clLen[CL_ORDER[i]!]!, 3);
    const clCodes = buildCanonicalCodes(dyn.clLen, 7);
    for (const item of dyn.rle) {
      writer.writeBits(clCodes[item.sym]!, dyn.clLen[item.sym]!);
      if (item.extraBits > 0) writer.writeBits(item.extra, item.extraBits);
    }
    const litCodes = buildCanonicalCodes(dyn.litLen, 15);
    const distCodes = buildCanonicalCodes(dyn.distLen, 15);
    writeTokens(writer, tokens, litCodes, dyn.litLen, distCodes, dyn.distLen);
  } else {
    writer.writeBits(3, 3);
    writeTokens(writer, tokens, FIXED_LIT.code, FIXED_LIT.bits, DIST_TABLE.code, DIST_TABLE.bits);
  }
  return writer.finish();
};

/** Encodes raw PNG scanline bytes into a deterministic zlib/DEFLATE stream. */
export const zlibDeflateFixed = (scanlines: Uint8Array): Uint8Array => {
  const compressed = deflateDynamicOrFixed(scanlines);
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
