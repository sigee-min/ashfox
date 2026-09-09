import { soundVariantSeed } from './variant';
export { soundVariantSeed } from './variant';
import { parseSoundSource } from './source';
import { render, master, measure } from './render';
import { encodeWav } from './wav';
import type { SoundProduct } from './contract';
export { parseSoundSource } from './source';
export { readRecipe } from './read';
export { render, master, measure } from './render';
export { encodeWav } from './wav';
export type { SoundRecipe, SoundProduct } from './contract';
export const AUDIO_POLICY = 'sound:separated-variant-streams:master-per-source:pcm16:v1';
export const compileSoundSource = (source: string, file: string): readonly SoundProduct[] => {
  const recipe = parseSoundSource(source, file);
  return Object.freeze([...recipe.variants].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(variant => {
    const seed = soundVariantSeed(recipe.seed, variant);
    const pcm = master(render({ ...recipe, seed }), recipe.output);
    return Object.freeze({ id: recipe.id, variant: variant.id, wav: encodeWav(pcm),
      frames: pcm.length, sampleRate: 48000 as const, channels: 1 as const, ...measure(pcm) });
  }));
};
