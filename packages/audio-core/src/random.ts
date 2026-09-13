import type { SoundRecipe, SoundVariant } from './contract';
export const AUDIO_POLICY = 'sound:curves-sequences-variation-resonator-loop:fixed-gain:pcm16';
export type Domain = 'timing' | 'pitch' | 'gain' | 'duration' | 'noise' | 'breath' | 'jitter' | 'trill-phase' | 'excitation';
export const randomSeed = (key: readonly (string | number)[]): number => {
  let h = 2166136261;
  for (const byte of new TextEncoder().encode(JSON.stringify(key))) h = Math.imul(h ^ byte, 16777619) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13;
  return (h >>> 0) || 1;
};
export const random = (seed: number): (() => number) => () => {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  return (seed >>> 0) / 0x100000000;
};
export const streams = (recipe: SoundRecipe, variant: SoundVariant, sequence: string, iteration: number, step: string, voice: string) =>
  (domain: Domain): (() => number) => random(randomSeed([AUDIO_POLICY, recipe.id, recipe.seed, variant.id, variant.seed, sequence, iteration, step, voice, domain]));
