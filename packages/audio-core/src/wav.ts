/** Fixed PCM16 mono encoding; no host metadata or encoder process. */
export const encodeWav = (pcm: Float64Array, rate = 48000): Uint8Array => {
  const bytes = new Uint8Array(44 + pcm.length * 2), view = new DataView(bytes.buffer);
  const word = (offset: number, value: string): void => {
    for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);
  };
  word(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); word(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  word(36, 'data'); view.setUint32(40, pcm.length * 2, true);
  pcm.forEach((sample, i) => {
    if (!Number.isFinite(sample) || Math.abs(sample) > 1) throw new Error('Non-finite or clipped PCM');
    view.setInt16(44 + i * 2, Math.round(sample * 32767), true);
  });
  return bytes;
};
