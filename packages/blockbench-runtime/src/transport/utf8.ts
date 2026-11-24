export const createStrictUtf8Decoder = (): TextDecoder | null =>
  typeof TextDecoder === 'undefined' ? null : new TextDecoder('utf-8', { fatal: true });

export const decodeStrictUtf8 = (bytes: Uint8Array): string | null => {
  const decoder = createStrictUtf8Decoder();
  if (!decoder) return null;
  try {
    return decoder.decode(bytes);
  } catch (_error) {
    return null;
  }
};
