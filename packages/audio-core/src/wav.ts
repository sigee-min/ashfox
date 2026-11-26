/** Fixed PCM16 mono or stereo encoding; no host metadata or encoder process. */
export const encodeWav = (pcm: Float64Array, rate = 48000, channels: 1 | 2 = 1): Uint8Array => {
  const blockAlign = channels * 2;
  const byteLength = pcm.length * 2;
  const bytes = new Uint8Array(44 + byteLength),
    view = new DataView(bytes.buffer);
  const word = (offset: number, value: string): void => {
    for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);
  };
  word(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  word(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  word(36, 'data');
  view.setUint32(40, byteLength, true);
  for (let i = 0; i < pcm.length; i += 1) {
    const sample = pcm[i]!;
    if (!Number.isFinite(sample) || Math.abs(sample) > 1)
      throw new Error('Non-finite or clipped PCM');
    view.setInt16(44 + i * 2, Math.round(sample * 32767), true);
  }
  return bytes;
};
