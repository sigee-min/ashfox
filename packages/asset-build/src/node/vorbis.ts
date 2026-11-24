import { createOggEncoder } from 'wasm-media-encoders';
import { OggVorbisDecoder } from '@wasm-audio-decoders/ogg-vorbis';
import { BuildFailure } from '../bundle/contract';
import type { PackEncoder } from '../packs/compile';

const CHUNK_FRAMES = 4096;
const MAX_OGG_BYTES = 16 * 1024 * 1024;
const VORBIS_QUALITY = 5;
const OGG_SERIAL_NUMBER = 0;

const ascii = (bytes: Uint8Array, start: number, end: number): string =>
  new TextDecoder('ascii').decode(bytes.subarray(start, end));

const assertNotAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new BuildFailure('build.cancelled', 'Encoding cancelled', 130);
};

const yieldTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const parseCanonicalMonoWav = (
  wav: Uint8Array,
): { readonly sampleRate: number; readonly samples: Float32Array } => {
  if (wav.length < 44) throw new BuildFailure('audio.invalid', 'Expected 48 kHz mono PCM16 WAV', 3);
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const sampleRate = view.getUint32(24, true);
  const dataSize = view.getUint32(40, true);
  if (
    ascii(wav, 0, 4) !== 'RIFF' ||
    ascii(wav, 8, 12) !== 'WAVE' ||
    ascii(wav, 12, 16) !== 'fmt ' ||
    ascii(wav, 36, 40) !== 'data' ||
    view.getUint16(20, true) !== 1 ||
    view.getUint16(22, true) !== 1 ||
    sampleRate !== 48000 ||
    view.getUint16(34, true) !== 16 ||
    dataSize !== wav.length - 44
  ) {
    throw new BuildFailure('audio.invalid', 'Expected 48 kHz mono PCM16 WAV', 3);
  }
  const frames = dataSize / 2;
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) samples[i] = view.getInt16(44 + i * 2, true) / 32768;
  return { sampleRate, samples };
};

const concatChunks = (chunks: readonly Uint8Array[], totalBytes: number): Uint8Array => {
  const out = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
};

export const decodeVorbis = async (
  ogg: Uint8Array,
): Promise<{
  readonly sampleRate: number;
  readonly channels: number;
  readonly samples: Float32Array;
}> => {
  if (ogg.length < 4 || ascii(ogg, 0, 4) !== 'OggS') {
    throw new BuildFailure('audio.invalid', 'Encoder did not return OGG', 3);
  }
  const decoder = new OggVorbisDecoder();
  await decoder.ready;
  try {
    const decoded = await decoder.decodeFile(ogg);
    if (decoded.errors.length > 0 || decoded.channelData.length === 0) {
      throw new BuildFailure('audio.invalid', 'Vorbis decode failed', 3);
    }
    return {
      sampleRate: decoded.sampleRate,
      channels: decoded.channelData.length,
      samples: decoded.channelData[0]!,
    };
  } finally {
    decoder.free();
  }
};

const encodeOggChunks = async (
  sampleRate: number,
  samples: Float32Array,
  signal?: AbortSignal,
): Promise<Uint8Array> => {
  const encoder = await createOggEncoder();
  encoder.configure({
    sampleRate,
    channels: 1,
    vbrQuality: VORBIS_QUALITY,
    oggSerialNo: OGG_SERIAL_NUMBER,
  });
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const append = (view: Uint8Array): void => {
    if (!view.length) return;
    totalBytes += view.length;
    if (totalBytes > MAX_OGG_BYTES) {
      throw new BuildFailure('audio.budget', 'Encoder output exceeded budget', 3);
    }
    chunks.push(Uint8Array.from(view));
  };
  for (let offset = 0; offset < samples.length; offset += CHUNK_FRAMES) {
    assertNotAborted(signal);
    const end = Math.min(offset + CHUNK_FRAMES, samples.length);
    append(encoder.encode([samples.subarray(offset, end)]));
    await yieldTurn();
  }
  append(encoder.finalize());
  return concatChunks(chunks, totalBytes);
};

export const createVorbisEncoder = async (signal?: AbortSignal): Promise<PackEncoder> => {
  assertNotAborted(signal);
  return {
    fingerprint: 'wasm-vorbis-q5-serial0-v1',
    encode: async (wav) => {
      assertNotAborted(signal);
      const { sampleRate, samples } = parseCanonicalMonoWav(wav);
      const encoded = await encodeOggChunks(sampleRate, samples, signal);
      const decoded = await decodeVorbis(encoded);
      if (!decoded.samples.length || Math.abs(decoded.samples.length - samples.length) > 1024) {
        throw new BuildFailure('audio.invalid', 'Vorbis duration mismatch', 3);
      }
      for (const sample of decoded.samples) {
        if (!Number.isFinite(sample) || Math.abs(sample) >= 1) {
          throw new BuildFailure('audio.clipping', 'Decoded Vorbis clips; lower source peakDb', 1);
        }
      }
      return encoded;
    },
  };
};
