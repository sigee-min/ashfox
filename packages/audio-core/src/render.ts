import type { SoundRecipe, SoundVariant } from './contract';
import { readRecipe } from './read';
import { createVoice } from './voice';
import { createChirp } from './chirp';
import { createFm } from './fm';
import { createResonator } from './resonator';
import { schedule } from './schedule';
import { evaluate, frame } from './curve';
import { fail } from './validate';
const TAU = Math.PI * 2;
export const measure = (pcm: Float64Array) => {
  let peak = 0,
    sum = 0,
    dc = 0,
    maxAdjacentDelta = 0;
  for (let i = 0; i < pcm.length; i++) {
    const value = pcm[i];
    if (!Number.isFinite(value)) throw new Error('sound.nonfinite: non-finite PCM');
    peak = Math.max(peak, Math.abs(value));
    sum += value * value;
    dc += value;
    if (i) maxAdjacentDelta = Math.max(maxAdjacentDelta, Math.abs(value - pcm[i - 1]));
  }
  return {
    peak,
    rms: Math.sqrt(sum / pcm.length),
    dc: dc / pcm.length,
    seamDelta: Math.abs(pcm[0] - pcm[pcm.length - 1]),
    maxAdjacentDelta,
  };
};
const createSourceSampler = (
  event: ReturnType<typeof schedule> extends Generator<infer E> ? E : never,
  rate: number,
): ((i: number) => number) => {
  const { voice, frames: length } = event;
  const source = voice.source;
  const bipolar = (domain: 'noise' | 'breath' | 'jitter' | 'trill-phase') => {
    const r = event.stream(domain);
    return () => r() * 2 - 1;
  };
  if (source.kind === 'fm') {
    const fm = createFm(source, length, event.pitch);
    return (i) => fm(i);
  }
  if (source.kind === 'vocal') {
    const vocal = createVoice(source, rate, event.pitch, bipolar('jitter'), bipolar('breath'));
    return (i) => vocal(i / (length - 1));
  }
  if (source.kind === 'chirp') {
    const chirp = createChirp(
      source,
      rate,
      event.pitch,
      bipolar('jitter'),
      bipolar('breath'),
      bipolar('trill-phase'),
    );
    return (i) => chirp(i / rate, i / (length - 1));
  }
  if (source.kind === 'resonator') {
    return createResonator(source, event.pitch, event.stream('excitation'));
  }
  return bipolar('noise');
};

export const render = (
  input: SoundRecipe,
  variant: SoundVariant = input.variants[0],
): Float64Array => {
  const recipe = readRecipe(input);
  const rate = recipe.sampleRate;
  if (!recipe.variants.some((v) => v.id === variant.id && v.seed === variant.seed))
    fail('recipe.variants', 'renderer variant must be declared');
  const result = new Float64Array(frame(recipe.duration));
  for (const event of schedule(recipe, variant)) {
    const sampler = createSourceSampler(event, rate);
    const { voice, frames: length, start } = event;
    let previous = 0,
      hp = 0,
      lp = 0;
    for (let i = 0; i < length; i++) {
      const u = i / (length - 1);
      const value = sampler(i);
      const hpA = Math.exp((-TAU * evaluate(voice.highpass, u)) / rate);
      const lpA = 1 - Math.exp((-TAU * evaluate(voice.lowpass, u)) / rate);
      hp = hpA * (hp + value - previous);
      previous = value;
      lp += lpA * (hp - lp);
      const sample = lp * evaluate(voice.gain, u) * event.gain;
      if (!Number.isFinite(sample)) fail(event.path, `non-finite DSP sample at frame ${i}`);
      result[start + i] += sample;
    }
  }
  measure(result);
  return result;
};
export const master = (pcm: Float64Array, policy: SoundRecipe['output']): Float64Array => {
  const gain = 10 ** (policy.gainDb / 20),
    result = new Float64Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) result[i] = pcm[i] * gain;
  const stats = measure(result),
    ceiling = 10 ** (policy.peakDb / 20);
  if (stats.rms < 1e-8)
    fail('recipe.output.gainDb', `silent output RMS ${stats.rms}; minimum 1e-8`);
  if (stats.peak > ceiling)
    fail(
      'recipe.output.gainDb',
      `peak ${stats.peak} exceeds ${ceiling}; lower gainDb below ${(policy.gainDb + 20 * Math.log10(ceiling / stats.peak)).toFixed(3)}`,
    );
  return result;
};
