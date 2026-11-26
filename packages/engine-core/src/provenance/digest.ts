import { encodeUtf8 } from '@ashfox/internal-contracts';

const SHA_256_ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const HEX_CHARS = '0123456789abcdef';
const SCRATCH_STATE = new Uint32Array(8);
const SCRATCH_WORDS = new Uint32Array(64);
const SCRATCH_TAIL = new Uint8Array(128);

const initSha256State = (state: Uint32Array): void => {
  state[0] = 0x6a09e667;
  state[1] = 0xbb67ae85;
  state[2] = 0x3c6ef372;
  state[3] = 0xa54ff53a;
  state[4] = 0x510e527f;
  state[5] = 0x9b05688c;
  state[6] = 0x1f83d9ab;
  state[7] = 0x5be0cd19;
};

const buildSha256Tail = (
  input: Uint8Array,
  tailStart: number,
  tailLength: number,
  totalBytes: number,
): number => {
  const paddedLength = tailLength < 56 ? 64 : 128;
  SCRATCH_TAIL.fill(0, tailLength, paddedLength);
  for (let i = 0; i < tailLength; i += 1) SCRATCH_TAIL[i] = input[tailStart + i]!;
  SCRATCH_TAIL[tailLength] = 0x80;
  const hi = Math.floor(totalBytes / 0x20000000) >>> 0;
  const lo = (totalBytes << 3) >>> 0;
  SCRATCH_TAIL[paddedLength - 8] = (hi >>> 24) & 0xff;
  SCRATCH_TAIL[paddedLength - 7] = (hi >>> 16) & 0xff;
  SCRATCH_TAIL[paddedLength - 6] = (hi >>> 8) & 0xff;
  SCRATCH_TAIL[paddedLength - 5] = hi & 0xff;
  SCRATCH_TAIL[paddedLength - 4] = (lo >>> 24) & 0xff;
  SCRATCH_TAIL[paddedLength - 3] = (lo >>> 16) & 0xff;
  SCRATCH_TAIL[paddedLength - 2] = (lo >>> 8) & 0xff;
  SCRATCH_TAIL[paddedLength - 1] = lo & 0xff;
  return paddedLength;
};

const compressSha256Blocks = (
  state: Uint32Array,
  words: Uint32Array,
  bytes: Uint8Array,
  limit: number,
): void => {
  for (let block = 0; block < limit; block += 64) {
    for (let i = 0; i < 16; i += 1) {
      const o = block + i * 4;
      words[i] =
        ((bytes[o]! << 24) | (bytes[o + 1]! << 16) | (bytes[o + 2]! << 8) | bytes[o + 3]!) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const p15 = words[i - 15]!;
      const p2 = words[i - 2]!;
      const sig0 = ((p15 >>> 7) | (p15 << 25)) ^ ((p15 >>> 18) | (p15 << 14)) ^ (p15 >>> 3);
      const sig1 = ((p2 >>> 17) | (p2 << 15)) ^ ((p2 >>> 19) | (p2 << 13)) ^ (p2 >>> 10);
      words[i] = (words[i - 16]! + sig0 + words[i - 7]! + sig1) >>> 0;
    }
    let a = state[0]!;
    let b = state[1]!;
    let c = state[2]!;
    let d = state[3]!;
    let e = state[4]!;
    let f = state[5]!;
    let g = state[6]!;
    let h = state[7]!;
    for (let i = 0; i < 64; i += 1) {
      const sum1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (h + sum1 + ((e & f) ^ (~e & g)) + SHA_256_ROUND_CONSTANTS[i]! + words[i]!) >>> 0;
      const sum0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (sum0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    state[0] = (state[0]! + a) >>> 0;
    state[1] = (state[1]! + b) >>> 0;
    state[2] = (state[2]! + c) >>> 0;
    state[3] = (state[3]! + d) >>> 0;
    state[4] = (state[4]! + e) >>> 0;
    state[5] = (state[5]! + f) >>> 0;
    state[6] = (state[6]! + g) >>> 0;
    state[7] = (state[7]! + h) >>> 0;
  }
};

const formatSha256Hex = (state: Uint32Array): string => {
  let out = 'sha256:';
  for (let index = 0; index < 8; index += 1) {
    const word = state[index]!;
    out +=
      HEX_CHARS[(word >>> 28) & 0xf]! +
      HEX_CHARS[(word >>> 24) & 0xf]! +
      HEX_CHARS[(word >>> 20) & 0xf]! +
      HEX_CHARS[(word >>> 16) & 0xf]! +
      HEX_CHARS[(word >>> 12) & 0xf]! +
      HEX_CHARS[(word >>> 8) & 0xf]! +
      HEX_CHARS[(word >>> 4) & 0xf]! +
      HEX_CHARS[word & 0xf]!;
  }
  return out;
};

/** A synchronous, runtime-neutral SHA-256 implementation for Node and web. */
export const sha256ByteDigest = (inputBytes: ArrayLike<number>): string => {
  const input =
    inputBytes instanceof Uint8Array
      ? inputBytes.constructor === Uint8Array
        ? inputBytes
        : new Uint8Array(inputBytes.buffer, inputBytes.byteOffset, inputBytes.byteLength)
      : Uint8Array.from(inputBytes);
  const tailLength = input.length & 63;
  const completeLength = input.length - tailLength;
  const paddedLength = buildSha256Tail(input, completeLength, tailLength, input.length);
  initSha256State(SCRATCH_STATE);
  if (completeLength > 0) compressSha256Blocks(SCRATCH_STATE, SCRATCH_WORDS, input, completeLength);
  compressSha256Blocks(SCRATCH_STATE, SCRATCH_WORDS, SCRATCH_TAIL, paddedLength);
  return formatSha256Hex(SCRATCH_STATE);
};

export const sha256Digest = (value: string): string => sha256ByteDigest(encodeUtf8(value));
