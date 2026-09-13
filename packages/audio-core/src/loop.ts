import type { SoundRecipe } from './contract';
import { frame } from './curve';
export const bakeLoop = (pcm: Float64Array, playback: SoundRecipe['playback']): Float64Array => {
  if (playback.kind === 'oneshot') return pcm;
  const s = frame(playback.start), e = frame(playback.end), x = frame(playback.crossfade);
  const result = new Float64Array(e - s - x);
  result.set(pcm.subarray(s + x, e - x));
  for (let k = 0; k < x; k++) {
    const u = k / (x - 1), w = u * u * (3 - 2 * u);
    result[e - s - 2 * x + k] = (1 - w) * pcm[e - x + k] + w * pcm[s + k];
  }
  return result;
};
