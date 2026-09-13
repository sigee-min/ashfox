import type { SoundProduct } from '@ashfox/audio-core';
import { BuildFailure } from './contract';

/** Playback describes the baked PCM, never raw authoring coordinates. */
export const readPlayback = (value: unknown, frames: number): SoundProduct['playback'] => {
  const fail = (): never => { throw new BuildFailure('output.integrity', 'Invalid sound playback metadata', 3); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const r = value as Record<string, unknown>;
  if (r.kind === 'oneshot' && Object.keys(r).length === 1) return { kind: 'oneshot' };
  if (r.kind !== 'loop' || Object.keys(r).length !== 3 || r.startFrame !== 0 ||
      r.endFrame !== frames || !Number.isSafeInteger(frames) || frames < 2400) return fail();
  return { kind: 'loop', startFrame: 0, endFrame: frames };
};

export const verifyPcm = (bytes: Uint8Array, frames: number): void => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const word = (offset: number, value: string): boolean =>
    [...value].every((c, i) => bytes[offset + i] === c.charCodeAt(0));
  if (bytes.length !== 44 + frames * 2 || !word(0, 'RIFF') || !word(8, 'WAVEfmt ') ||
      !word(36, 'data') || view.getUint32(4, true) !== bytes.length - 8 ||
      view.getUint32(16, true) !== 16 || view.getUint16(20, true) !== 1 ||
      view.getUint16(22, true) !== 1 || view.getUint32(24, true) !== 48000 ||
      view.getUint32(28, true) !== 96000 || view.getUint16(32, true) !== 2 ||
      view.getUint16(34, true) !== 16 || view.getUint32(40, true) !== frames * 2) {
    throw new BuildFailure('output.integrity', 'Sound metadata does not match mono 48 kHz PCM16 WAV', 3);
  }
};

export const pcmStatistics = (bytes: Uint8Array, frames: number) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let peak = 0, sum = 0, dc = 0, maxAdjacentDelta = 0, previous = 0, first = 0;
  for (let i = 0; i < frames; i++) {
    const value = view.getInt16(44 + i * 2, true) / 32767;
    if (!i) first = value;
    peak = Math.max(peak, Math.abs(value)); sum += value * value; dc += value;
    if (i) maxAdjacentDelta = Math.max(maxAdjacentDelta, Math.abs(value - previous));
    previous = value;
  }
  return { peak, rms: Math.sqrt(sum / frames), dc: dc / frames,
    seamDelta: Math.abs(first - previous), maxAdjacentDelta };
};
