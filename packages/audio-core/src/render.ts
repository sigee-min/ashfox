import type { SoundRecipe, SoundVariant } from './contract';
import { createChirp } from './chirp';
import { evaluate, frame } from './curve';
import { evaluateGain } from './envelope';
import { createSvf } from './filter';
import { createFm } from './fm';
import { createNoise } from './noise';
import { createOsc } from './osc';
import { readRecipe } from './read';
import { createResonator } from './resonator';
import { schedule, type Event } from './schedule';
import { applySpace } from './space';
import { fail } from './validate';
import { createVoice } from './voice';

export const measure = (pcm: Float64Array, channels: 1 | 2 = 1) => {
  const frames = pcm.length / channels;
  let peak = 0,
    sum = 0,
    dc = 0,
    maxAdjacentDelta = 0,
    seamDelta = 0;
  for (let i = 0; i < pcm.length; i++) {
    const value = pcm[i];
    if (!Number.isFinite(value)) throw new Error('sound.nonfinite: non-finite PCM');
    peak = Math.max(peak, Math.abs(value));
    sum += value * value;
    dc += value;
  }
  for (let ch = 0; ch < channels; ch++) {
    seamDelta = Math.max(seamDelta, Math.abs(pcm[ch] - pcm[(frames - 1) * channels + ch]));
    for (let i = 1; i < frames; i++) {
      maxAdjacentDelta = Math.max(
        maxAdjacentDelta,
        Math.abs(pcm[i * channels + ch] - pcm[(i - 1) * channels + ch]),
      );
    }
  }
  return {
    peak,
    rms: Math.sqrt(sum / pcm.length),
    dc: dc / pcm.length,
    seamDelta,
    maxAdjacentDelta,
  };
};

const createSourceSampler = (event: Event, rate: number): ((i: number) => number) => {
  const { voice, frames: length } = event;
  const source = voice.source;
  const invLen = 1 / Math.max(1, length - 1);
  const bipolar = (domain: 'noise' | 'breath' | 'jitter' | 'trill-phase') => {
    const r = event.stream(domain);
    return () => r() * 2 - 1;
  };
  if (source.kind === 'osc') {
    const osc = createOsc(source, rate, event.pitch);
    return (i) => osc(i * invLen);
  }
  if (source.kind === 'fm') {
    const fm = createFm(source, length, event.pitch);
    return (i) => fm(i);
  }
  if (source.kind === 'vocal') {
    const vocal = createVoice(source, rate, event.pitch, bipolar('jitter'), bipolar('breath'));
    return (i) => vocal(i * invLen);
  }
  if (source.kind === 'chirp') {
    const chirp = createChirpForEvent(event, rate, bipolar);
    return (i) => chirp(i / rate, i * invLen);
  }
  if (source.kind === 'resonator') {
    return createResonator(source, event.pitch, event.stream('excitation'));
  }
  return createNoise(source, rate, event.stream('noise'));
};

const createChirpForEvent = (
  event: Event,
  rate: number,
  bipolar: (d: 'noise' | 'breath' | 'jitter' | 'trill-phase') => () => number,
) => {
  if (event.voice.source.kind !== 'chirp') throw new Error('expected chirp');
  return createChirp(
    event.voice.source,
    rate,
    event.pitch,
    bipolar('jitter'),
    bipolar('breath'),
    bipolar('trill-phase'),
  );
};

type FilterNode = ReturnType<typeof createSvf>;

const applyVoiceFilters = (
  voice: Event['voice'],
  sig: number,
  u: number,
  hp: FilterNode | null,
  svf: FilterNode | null,
  lp: FilterNode | null,
  drive: number,
  driveNorm: number,
): number => {
  let out = sig;
  if (hp) out = hp(out, evaluate(voice.highpass!, u), 0.7071);
  if (svf && voice.filter) {
    const q = voice.filter.q !== undefined ? evaluate(voice.filter.q, u) : 0.7071;
    out = svf(out, evaluate(voice.filter.cutoff, u), q);
  }
  if (lp) out = lp(out, evaluate(voice.lowpass!, u), 0.7071);
  return drive > 0 ? Math.tanh((1 + drive) * out) * driveNorm : out;
};

const writeFrame = (
  result: Float64Array,
  channels: 1 | 2,
  idx: number,
  sample: number,
  panL: number,
  panR: number,
): void => {
  if (channels === 1) {
    result[idx] += sample;
    return;
  }
  result[idx * 2] += sample * panL;
  result[idx * 2 + 1] += sample * panR;
};

const renderEventInto = (
  event: Event,
  rate: number,
  channels: 1 | 2,
  result: Float64Array,
): void => {
  const sampler = createSourceSampler(event, rate);
  const { voice, frames: length, start } = event;
  const hp = voice.highpass !== undefined ? createSvf('highpass', rate) : null;
  const lp = voice.lowpass !== undefined ? createSvf('lowpass', rate) : null;
  const svf = voice.filter ? createSvf(voice.filter.kind, rate) : null;
  const drive = voice.drive ?? 0;
  const driveNorm = drive > 0 ? 1 / Math.tanh(1 + drive) : 1;
  const angle = (((voice.pan ?? 0) + 1) * Math.PI) / 4;
  const panL = channels === 2 ? Math.cos(angle) : 1;
  const panR = channels === 2 ? Math.sin(angle) : 0;
  const invLen = 1 / Math.max(1, length - 1);
  for (let i = 0; i < length; i++) {
    const u = i * invLen;
    const sig = applyVoiceFilters(voice, sampler(i), u, hp, svf, lp, drive, driveNorm);
    const sample = sig * evaluateGain(voice.gain, i, length, rate) * event.gain;
    if (!Number.isFinite(sample)) fail(event.path, `non-finite DSP sample at frame ${i}`);
    writeFrame(result, channels, start + i, sample, panL, panR);
  }
};

const assertFiniteSamples = (pcm: Float64Array): void => {
  for (let i = 0; i < pcm.length; i++) {
    if (!Number.isFinite(pcm[i])) throw new Error('sound.nonfinite: non-finite PCM');
  }
};

export const renderValidatedRecipe = (recipe: SoundRecipe, variantId?: string): Float64Array => {
  const variant =
    variantId === undefined ? recipe.variants[0] : recipe.variants.find((v) => v.id === variantId);
  if (!variant) return fail('recipe.variants', 'renderer variant must be declared');
  const rate = recipe.sampleRate;
  const channels = recipe.channels ?? 1;
  const result = new Float64Array(frame(recipe.duration) * channels);
  for (const event of schedule(recipe, variant)) renderEventInto(event, rate, channels, result);
  const spaced = applySpace(result, channels, rate, recipe.space);
  assertFiniteSamples(spaced);
  return spaced;
};

export const render = (
  input: SoundRecipe,
  variant: SoundVariant = input.variants[0],
): Float64Array => {
  const recipe = readRecipe(input);
  if (!recipe.variants.some((v) => v.id === variant.id && v.seed === variant.seed))
    fail('recipe.variants', 'renderer variant must be declared');
  return renderValidatedRecipe(recipe, variant.id);
};

export const master = (
  pcm: Float64Array,
  policy: SoundRecipe['output'],
  channels: 1 | 2 = 1,
): Float64Array => {
  const gain = 10 ** (policy.gainDb / 20),
    ceiling = 10 ** (policy.peakDb / 20),
    result = new Float64Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    let x = pcm[i] * gain;
    if (policy.softClip) x = ceiling * Math.tanh(x / ceiling);
    result[i] = x;
  }
  const stats = measure(result, channels);
  if (stats.rms < 1e-8)
    fail('recipe.output.gainDb', `silent output RMS ${stats.rms}; minimum 1e-8`);
  if (stats.peak > ceiling)
    fail(
      'recipe.output.gainDb',
      `peak ${stats.peak} exceeds ${ceiling}; lower gainDb below ${(policy.gainDb + 20 * Math.log10(ceiling / stats.peak)).toFixed(3)}`,
    );
  return result;
};
