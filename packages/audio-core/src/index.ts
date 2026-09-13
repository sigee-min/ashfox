import { parseSoundDocument } from './source';
import { SoundError, fail } from './validate';
import { render, master, measure } from './render';
import { encodeWav } from './wav';
import { bakeLoop } from './loop';
import { frame } from './curve';
import { readRecipe } from './read';
import { validatePlan } from './plan';
import type { SoundProduct, SoundRecipe } from './contract';
export { parseSoundSource } from './source';
export { readRecipe } from './read';
export { render, master, measure } from './render';
export { encodeWav } from './wav';
export { AUDIO_POLICY } from './random';
export type { SoundBudget } from './plan';
export const soundBudget = (recipe: SoundRecipe) => validatePlan(readRecipe(recipe));
export type { SoundRecipe, SoundProduct, SoundPlayback, SoundVoice, SoundVariant, Control, Curve } from './contract';
export const compileSoundSource = (source: string, file: string): readonly SoundProduct[] => {
  const { recipe, report } = parseSoundDocument(source, file), products: SoundProduct[] = [];
  for (const variant of [...recipe.variants].sort((a, b) => a.id < b.id ? -1 : 1)) {
    try {
      const pcm = master(bakeLoop(render(recipe, variant), recipe.playback), recipe.output), wav = encodeWav(pcm);
      const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
      for (let i = 0; i < pcm.length; i++) pcm[i] = view.getInt16(44 + i * 2, true) / 32767;
      const stats = measure(pcm);
      if (stats.peak === 0) fail('recipe.output.gainDb', 'output quantizes to silence');
      if (stats.peak > 10 ** (recipe.output.peakDb / 20)) fail('recipe.output.gainDb', `decoded PCM16 peak ${stats.peak} exceeds ceiling; lower gainDb below ${(recipe.output.gainDb + 20 * Math.log10(10 ** (recipe.output.peakDb / 20) / stats.peak)).toFixed(3)}`);
      products.push(Object.freeze({ id: recipe.id, variant: variant.id, wav,
        frames: pcm.length, rawFrames: frame(recipe.duration), sampleRate: 48000, channels: 1, ...stats,
        playback: Object.freeze(recipe.playback.kind === 'oneshot' ? { kind: 'oneshot' as const } : { kind: 'loop' as const, startFrame: 0 as const, endFrame: pcm.length }) }));
    } catch (error) {
      return report(error instanceof SoundError ? new SoundError(error.path, `${error.detail}; variant ${variant.id}`) : error);
    }
  }
  return Object.freeze(products);
};
