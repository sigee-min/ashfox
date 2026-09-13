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
  let peak = 0, sum = 0, dc = 0, maxAdjacentDelta = 0;
  for (let i = 0; i < pcm.length; i++) {
    const value = pcm[i];
    if (!Number.isFinite(value)) throw new Error('sound.nonfinite: non-finite PCM');
    peak = Math.max(peak, Math.abs(value)); sum += value * value; dc += value;
    if (i) maxAdjacentDelta = Math.max(maxAdjacentDelta, Math.abs(value - pcm[i - 1]));
  }
  return { peak, rms: Math.sqrt(sum / pcm.length), dc: dc / pcm.length,
    seamDelta: Math.abs(pcm[0] - pcm[pcm.length - 1]), maxAdjacentDelta };
};
export const render = (input: SoundRecipe, variant: SoundVariant = input.variants[0]): Float64Array => {
  const recipe = readRecipe(input), rate = recipe.sampleRate;
  if (!recipe.variants.some(v => v.id === variant.id && v.seed === variant.seed)) fail('recipe.variants', 'renderer variant must be declared');
  const result = new Float64Array(frame(recipe.duration));
  for (const event of schedule(recipe, variant)) {
    const { voice, frames: length, start } = event, source = voice.source;
    const bipolar = (domain: 'noise' | 'breath' | 'jitter' | 'trill-phase') => { const r = event.stream(domain); return () => r() * 2 - 1; };
    const noise = bipolar('noise');
    const fm = source.kind === 'fm' ? createFm(source, length, event.pitch) : null;
    const vocal = source.kind === 'vocal' ? createVoice(source, rate, event.pitch, bipolar('jitter'), bipolar('breath')) : null;
    const chirp = source.kind === 'chirp' ? createChirp(source, rate, event.pitch, bipolar('jitter'), bipolar('breath'), bipolar('trill-phase')) : null;
    const resonator = source.kind === 'resonator' ? createResonator(source, event.pitch, event.stream('excitation')) : null;
    let previous = 0, hp = 0, lp = 0;
    for (let i = 0; i < length; i++) {
      const t = i / rate, u = i / (length - 1);
      let value: number;
      if (fm) value = fm(i);
      else if (chirp) value = chirp(t, u);
      else if (vocal) value = vocal(u);
      else if (resonator) value = resonator(i);
      else value = noise();
      const hpA = Math.exp(-TAU * evaluate(voice.highpass, u) / rate), lpA = 1 - Math.exp(-TAU * evaluate(voice.lowpass, u) / rate);
      hp = hpA * (hp + value - previous); previous = value; lp += lpA * (hp - lp);
      const sample = lp * evaluate(voice.gain, u) * event.gain;
      if (!Number.isFinite(sample)) fail(event.path, `non-finite DSP sample at frame ${i}`);
      result[start + i] += sample;
    }
  }
  measure(result); return result;
};
export const master = (pcm: Float64Array, policy: SoundRecipe['output']): Float64Array => {
  const gain = 10 ** (policy.gainDb / 20), result = new Float64Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) result[i] = pcm[i] * gain;
  const stats = measure(result), ceiling = 10 ** (policy.peakDb / 20);
  if (stats.rms < 1e-8) fail('recipe.output.gainDb', `silent output RMS ${stats.rms}; minimum 1e-8`);
  if (stats.peak > ceiling) fail('recipe.output.gainDb', `peak ${stats.peak} exceeds ${ceiling}; lower gainDb below ${(policy.gainDb + 20 * Math.log10(ceiling / stats.peak)).toFixed(3)}`);
  return result;
};
