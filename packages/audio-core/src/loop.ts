import type { SoundRecipe } from './contract';
import { frame } from './curve';

export const bakeLoop = (
  pcm: Float64Array,
  playback: SoundRecipe['playback'],
  channels: 1 | 2 = 1,
): Float64Array => {
  if (playback.kind === 'oneshot') return pcm;
  const s = frame(playback.start),
    e = frame(playback.end),
    x = frame(playback.crossfade);
  const result = new Float64Array((e - s - x) * channels);
  result.set(pcm.subarray((s + x) * channels, (e - x) * channels));
  const tailStart = (e - s - 2 * x) * channels;
  for (let k = 0; k < x; k += 1) {
    const u = k / (x - 1),
      w = u * u * (3 - 2 * u);
    for (let ch = 0; ch < channels; ch += 1) {
      result[tailStart + k * channels + ch] =
        (1 - w) * pcm[(e - x + k) * channels + ch]! + w * pcm[(s + k) * channels + ch]!;
    }
  }
  return result;
};
