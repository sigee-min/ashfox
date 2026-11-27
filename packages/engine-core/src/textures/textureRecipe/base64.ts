const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const BASE64_LOOKUP = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < BASE64_ALPHABET.length; i += 1) {
    table[BASE64_ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

/** Pure host-independent base64 encoder for canonical binary payloads. */
export const encodeBase64Bytes = (bytes: Uint8Array): string => {
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const has1 = i + 1 < bytes.length;
    const has2 = i + 2 < bytes.length;
    const b1 = has1 ? bytes[i + 1]! : 0;
    const b2 = has2 ? bytes[i + 2]! : 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    chunks.push(
      BASE64_ALPHABET[(triple >> 18) & 0x3f]! +
        BASE64_ALPHABET[(triple >> 12) & 0x3f]! +
        (has1 ? BASE64_ALPHABET[(triple >> 6) & 0x3f]! : '=') +
        (has2 ? BASE64_ALPHABET[triple & 0x3f]! : '='),
    );
  }
  return chunks.join('');
};

const decodeB64Char = (clean: string, index: number, allowPad: boolean): number => {
  if (allowPad && clean[index] === '=') return 0;
  const val = BASE64_LOOKUP[clean.charCodeAt(index)];
  return val === undefined ? -1 : val;
};

/** Pure host-independent base64 decoder for canonical binary payloads. */
export const decodeBase64Bytes = (encoded: string): Uint8Array => {
  const clean = encoded.replace(/\s+/g, '');
  if (clean.length % 4 !== 0) throw new Error('Invalid base64 payload length.');
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((clean.length / 4) * 3 - pad);
  let outPos = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = decodeB64Char(clean, i, false);
    const c1 = decodeB64Char(clean, i + 1, false);
    const c2 = decodeB64Char(clean, i + 2, true);
    const c3 = decodeB64Char(clean, i + 3, true);
    if (c0 < 0 || c1 < 0 || c2 < 0 || c3 < 0) throw new Error('Invalid base64 character.');
    const triple = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    out[outPos++] = (triple >> 16) & 0xff;
    if (outPos < out.length) out[outPos++] = (triple >> 8) & 0xff;
    if (outPos < out.length) out[outPos++] = triple & 0xff;
  }
  return out;
};
