import { spawn } from 'node:child_process';
import { BuildFailure } from '../contract';
import { digest } from '../digest';
import type { PackEncoder } from '../packs';
/** No shell or temporary output files; cancellation owns and kills the encoder. */
const execute = (file: string, args: readonly string[], signal?: AbortSignal, input?: Uint8Array): Promise<Uint8Array> => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(new BuildFailure('build.cancelled', 'Encoding cancelled', 130)); return; }
  const child = spawn(file, [...args], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const chunks: Buffer[] = [], errors: Buffer[] = [];
  let total = 0, errorSize = 0, failure: BuildFailure | undefined;
  const stop = (error: BuildFailure): void => { failure ??= error; child.kill('SIGKILL'); };
  const cancel = (): void => stop(new BuildFailure('build.cancelled', 'Encoding cancelled', 130));
  const timer = setTimeout(() => stop(new BuildFailure('audio.timeout', 'Vorbis encoder exceeded 15 seconds', 3)), 15000);
  const cleanup = (): void => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); };
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  child.stdout.on('data', (data: Buffer) => {
    total += data.length;
    if (total > 16 * 1024 * 1024) stop(new BuildFailure('audio.budget', 'Encoder output exceeded budget', 3));
    else chunks.push(data);
  });
  child.stderr.on('data', (data: Buffer) => { errorSize += data.length; if (errorSize <= 8192) errors.push(data); });
  child.on('error', error => { cleanup(); reject(new BuildFailure('audio.encoder',
    `Cannot run FFmpeg. Install it or set ASHFOX_FFMPEG_PATH. ${error.message}`, 3)); });
  child.on('close', code => {
    cleanup();
    if (failure) reject(failure);
    else if (code !== 0) reject(new BuildFailure('audio.encoder', 'FFmpeg failed: ' + Buffer.concat(errors).toString(), 3));
    else resolve(new Uint8Array(Buffer.concat(chunks)));
  });
  child.stdin.on('error', () => { /* Early exit is reported by close/error. */ });
  child.stdin.end(input);
});
export const createVorbisEncoder = async (signal?: AbortSignal): Promise<PackEncoder> => {
  const file = process.env.ASHFOX_FFMPEG_PATH || 'ffmpeg';
  const version = await execute(file, ['-version'], signal);
  return {
    fingerprint: 'ffmpeg-libvorbis-q5-bitexact-v1:' + digest(version),
    encode: async wav => {
      const encoded = await execute(file, ['-v','error','-nostdin','-fflags','+bitexact','-i','pipe:0',
        '-map_metadata','-1','-ac','1','-ar','48000','-c:a','libvorbis','-q:a','5','-flags:a','+bitexact',
        '-fflags','+bitexact','-f','ogg','pipe:1'], signal, wav);
      if (new TextDecoder().decode(encoded.slice(0, 4)) !== 'OggS') throw new BuildFailure('audio.invalid', 'Encoder did not return OGG', 3);
      const decoded = await execute(file, ['-v','error','-nostdin','-i','pipe:0','-f','f32le','-ac','1','-ar','48000','pipe:1'], signal, encoded);
      // The native encoder owns a canonical 44-byte PCM16 mono WAV header.
      const frames = (wav.length - 44) / 2;
      if (!decoded.length || decoded.length % 4 || Math.abs(decoded.length / 4 - frames) > 1024) throw new BuildFailure('audio.invalid', 'Vorbis duration mismatch', 3);
      const view = new DataView(decoded.buffer, decoded.byteOffset, decoded.byteLength);
      for (let offset = 0; offset < decoded.length; offset += 4) {
        const sample = view.getFloat32(offset, true);
        if (!Number.isFinite(sample) || Math.abs(sample) >= 1) throw new BuildFailure('audio.clipping', 'Decoded Vorbis clips; lower source peakDb', 1);
      }
      return encoded;
    }
  };
};
