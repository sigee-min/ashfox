import type { MasterSpec, SoundRecipe, SoundVariant, SoundVoice } from './contract';
import { createChirp } from './chirp';
import { evaluate, frame } from './curve';
import { evaluateGain } from './envelope';
import { createStereoSvf, type StereoSvfNode } from './filter';
import { createFm } from './fm';
import { createVoiceFxRack } from './fx';
import { createGranular } from './granular';
import { applyMasterBus } from './master';
import { createMaterial } from './material';
import {
  applyDuckEnvelope,
  computeDuckEnvelope,
  createPitchDrift,
  sampleCircularDrift,
} from './mod';
import { createNoise } from './noise';
import { createOsc } from './osc';
import { random } from './random';
import { readRecipe } from './read';
import { schedule, type Event } from './schedule';
import { applySpace } from './space';
import { fail } from './validate';
import { createVoice } from './voice';
import { createWaveguide } from './waveguide';
import { createWhoosh } from './whoosh';

type StereoSampler = (i: number, outLR: Float64Array) => void;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const measure = (pcm: Float64Array, channels: 1 | 2 = 1) => {
  const frames = pcm.length / channels;
  let peak = 0;
  let sum = 0;
  let dc = 0;
  let maxAdjacentDelta = 0;
  let seamDelta = 0;
  for (let i = 0; i < pcm.length; i++) {
    const value = pcm[i]!;
    if (!Number.isFinite(value)) throw new Error('sound.nonfinite: non-finite PCM');
    peak = Math.max(peak, Math.abs(value));
    sum += value * value;
    dc += value;
  }
  for (let ch = 0; ch < channels; ch++) {
    seamDelta = Math.max(seamDelta, Math.abs(pcm[ch]! - pcm[(frames - 1) * channels + ch]!));
    for (let i = 1; i < frames; i++) {
      maxAdjacentDelta = Math.max(
        maxAdjacentDelta,
        Math.abs(pcm[i * channels + ch]! - pcm[(i - 1) * channels + ch]!),
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

const createSourceSampler = (event: Event, rate: number, channels: 1 | 2): StereoSampler => {
  const { voice, frames: length } = event;
  const source = voice.source;
  const invLen = 1 / Math.max(1, length - 1);
  const bipolar = (domain: 'noise' | 'breath' | 'jitter' | 'trill-phase') => {
    const r = event.stream(domain);
    return () => r() * 2 - 1;
  };
  if (source.kind === 'osc') {
    const osc = createOsc(source, rate, event.pitch);
    return (i, outLR) => osc(i * invLen, outLR);
  }
  if (source.kind === 'fm') {
    const fm = createFm(source, length, event.pitch);
    return (i, outLR) => fm(i, outLR);
  }
  if (source.kind === 'vocal') {
    const vocal = createVoice(source, rate, event.pitch, bipolar('jitter'), bipolar('breath'));
    return (i, outLR) => vocal(i * invLen, outLR);
  }
  if (source.kind === 'chirp') {
    const chirp = createChirpForEvent(event, rate, bipolar);
    return (i, outLR) => chirp(i / rate, i * invLen, outLR);
  }
  if (source.kind === 'material') {
    return createMaterial(source, length, event.pitch, event.stream('excitation'));
  }
  if (source.kind === 'granular') {
    return createGranular(
      source,
      rate,
      length,
      event.pitch,
      event.stream('grain'),
      event.stream('turbulence'),
    );
  }
  if (source.kind === 'whoosh') {
    return createWhoosh(source, rate, length, event.pitch, event.stream('vortex'));
  }
  if (source.kind === 'waveguide') {
    return createWaveguide(source, rate, length, event.pitch, event.stream('excitation'));
  }
  const noiseL = event.stream('noise');
  const noiseR =
    channels === 2
      ? random((Math.floor(noiseL() * 0xffffffff) ^ 0x9e3779b9) >>> 0 || 1)
      : undefined;
  const noise = createNoise(source, noiseL, noiseR);
  return (_i, outLR) => noise(outLR);
};

interface StereoFilterBank {
  readonly hp: StereoSvfNode | null;
  readonly svf: StereoSvfNode | null;
  readonly lp: StereoSvfNode | null;
  readonly anyDynamic: boolean;
}

const isCurve = (c: unknown): boolean => typeof c === 'object' && c !== null;

const initStereoFilter = (
  kind: 'lowpass' | 'highpass' | 'bandpass' | 'notch',
  rate: number,
  cutoff: SoundVoice['highpass'],
  q: SoundVoice['highpass'] = 0.7071,
): StereoSvfNode | null => {
  if (cutoff === undefined) return null;
  const node = createStereoSvf(kind, rate);
  if (typeof cutoff === 'number' && typeof q === 'number') node.setCoeffs(cutoff, q);
  return node;
};

const createStereoFilterBank = (voice: SoundVoice, rate: number): StereoFilterBank => ({
  hp: initStereoFilter('highpass', rate, voice.highpass),
  svf: voice.filter
    ? initStereoFilter(voice.filter.kind, rate, voice.filter.cutoff, voice.filter.q)
    : null,
  lp: initStereoFilter('lowpass', rate, voice.lowpass),
  anyDynamic:
    voice.drift?.target === 'cutoff' ||
    isCurve(voice.highpass) ||
    isCurve(voice.lowpass) ||
    isCurve(voice.filter?.cutoff) ||
    isCurve(voice.filter?.q),
});

const updateFilterCoeffs = (
  voice: SoundVoice,
  u: number,
  cutoffScale: number,
  bank: StereoFilterBank,
): void => {
  if (bank.hp && voice.highpass !== undefined) {
    bank.hp.setCoeffs(evaluate(voice.highpass, u) * cutoffScale, 0.7071);
  }
  if (bank.svf && voice.filter) {
    const q = voice.filter.q !== undefined ? evaluate(voice.filter.q, u) : 0.7071;
    bank.svf.setCoeffs(evaluate(voice.filter.cutoff, u) * cutoffScale, q);
  }
  if (bank.lp && voice.lowpass !== undefined) {
    bank.lp.setCoeffs(evaluate(voice.lowpass, u) * cutoffScale, 0.7071);
  }
};

const panGains = (pan: number, out: Float64Array): void => {
  if (pan === 0) {
    out[0] = 1;
    out[1] = 1;
    return;
  }
  const angle = ((clamp(pan, -1, 1) + 1) * Math.PI) / 4;
  out[0] = Math.SQRT2 * Math.cos(angle);
  out[1] = Math.SQRT2 * Math.sin(angle);
};

interface ControlCache {
  readonly panDynamic: boolean;
  readonly panLR: Float64Array;
  readonly hasEqOrDrive: boolean;
  readonly hasDrift: boolean;
  readonly gainIsScalar: boolean;
  readonly scalarGain: number;
  driftVal: number;
  gainDrift: number;
  cutoffScale: number;
}

const createControlCache = (event: Event, channels: 1 | 2): ControlCache => {
  const { voice } = event;
  const panLR = new Float64Array([1, 1]);
  const panDynamic =
    channels === 2 && (typeof voice.pan === 'object' || voice.drift?.target === 'pan');
  if (channels === 2 && !panDynamic && typeof voice.pan === 'number') {
    panGains(voice.pan, panLR);
  }
  const gainIsScalar = typeof voice.gain === 'number';
  return {
    panDynamic,
    panLR,
    hasEqOrDrive: voice.eq !== undefined || voice.drive !== undefined,
    hasDrift: voice.drift !== undefined,
    gainIsScalar,
    scalarGain: gainIsScalar ? (voice.gain as number) * event.gain : event.gain,
    driftVal: 0,
    gainDrift: 1,
    cutoffScale: 1,
  };
};

const refreshControlBlock = (
  event: Event,
  i: number,
  invLen: number,
  rate: number,
  totalFrames: number,
  loopFrames: number | undefined,
  filters: StereoFilterBank,
  ctrl: ControlCache,
): void => {
  const { voice, start } = event;
  const u = i * invLen;
  if (ctrl.hasDrift && voice.drift) {
    const timelineSpan = Math.max(1, totalFrames - 1);
    ctrl.driftVal = sampleCircularDrift(
      rate,
      (start + i) / timelineSpan,
      totalFrames,
      voice.drift,
      loopFrames,
    );
    if (voice.drift.target === 'cutoff') ctrl.cutoffScale = 2 ** ctrl.driftVal;
    else if (voice.drift.target === 'gain') ctrl.gainDrift = Math.max(0, 1 + ctrl.driftVal);
  }
  if (ctrl.panDynamic) {
    const basePan = voice.pan !== undefined ? evaluate(voice.pan, u) : 0;
    panGains(basePan + (voice.drift?.target === 'pan' ? ctrl.driftVal : 0), ctrl.panLR);
  }
  if (filters.anyDynamic) updateFilterCoeffs(voice, u, ctrl.cutoffScale, filters);
};

const applyFilterAndFxSample = (
  lr: Float64Array,
  filters: StereoFilterBank,
  fxRack: ReturnType<typeof createVoiceFxRack>,
  ctrl: ControlCache,
  channels: 1 | 2,
): void => {
  if (channels === 2) {
    lr[0] = lr[0]! * ctrl.panLR[0]!;
    lr[1] = lr[1]! * ctrl.panLR[1]!;
  }
  if (filters.hp) filters.hp.process(lr);
  if (filters.svf) filters.svf.process(lr);
  if (filters.lp) filters.lp.process(lr);
  if (ctrl.hasEqOrDrive) fxRack.applyEqAndDrive(lr);
};

const writeFrame = (
  voiceBuf: Float64Array,
  channels: 1 | 2,
  dst: number,
  lr: Float64Array,
  gain: number,
  path: string,
  localFrame: number,
): void => {
  const l = lr[0]! * gain;
  const r = lr[1]! * gain;
  if (!Number.isFinite(l) || !Number.isFinite(r)) {
    fail(path, `non-finite DSP sample at frame ${localFrame}`);
  }
  if (channels === 1) voiceBuf[dst] = voiceBuf[dst]! + 0.5 * (l + r);
  else {
    voiceBuf[dst * 2] = voiceBuf[dst * 2]! + l;
    voiceBuf[dst * 2 + 1] = voiceBuf[dst * 2 + 1]! + r;
  }
};

const renderEventIntoVoice = (
  event: Event,
  rate: number,
  channels: 1 | 2,
  totalFrames: number,
  loopFrames: number | undefined,
  voiceBuf: Float64Array,
): void => {
  const { voice, frames: length, start } = event;
  const sampler = createSourceSampler(event, rate, channels);
  const filters = createStereoFilterBank(voice, rate);
  const fxRack = createVoiceFxRack(voice, rate);
  const pitchDrift = voice.drift?.target === 'pitch' ? createPitchDrift(rate, voice.drift) : null;
  const ctrl = createControlCache(event, channels);
  const lr = new Float64Array(2);
  const invLen = 1 / Math.max(1, length - 1);
  const end = Math.min(length, totalFrames - start);

  for (let i = 0; i < end; i++) {
    if ((i & 15) === 0) {
      refreshControlBlock(event, i, invLen, rate, totalFrames, loopFrames, filters, ctrl);
    }
    sampler(i, lr);
    if (pitchDrift) pitchDrift.process(lr[0]!, lr[1]!, ctrl.driftVal, lr);
    applyFilterAndFxSample(lr, filters, fxRack, ctrl, channels);
    const gain =
      (ctrl.gainIsScalar
        ? ctrl.scalarGain
        : evaluateGain(voice.gain, i, length, rate) * event.gain) * ctrl.gainDrift;
    writeFrame(voiceBuf, channels, start + i, lr, gain, event.path, i);
  }
};

const orderDuckVoices = (voices: readonly SoundVoice[]): readonly SoundVoice[] => {
  const byId = new Map(voices.map((v) => [v.id, v]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const ordered: SoundVoice[] = [];
  const visit = (voice: SoundVoice): void => {
    if (visited.has(voice.id) || visiting.has(voice.id)) return;
    visiting.add(voice.id);
    if (voice.duck) {
      const trigger = byId.get(voice.duck.by);
      if (trigger) visit(trigger);
    }
    visiting.delete(voice.id);
    visited.add(voice.id);
    ordered.push(voice);
  };
  for (const voice of voices) visit(voice);
  return ordered;
};

const applyVoiceFxAndDucking = (
  voices: readonly SoundVoice[],
  voiceBuffers: Map<string, Float64Array>,
  channels: 1 | 2,
  rate: number,
): void => {
  for (const voice of voices) {
    const buf = voiceBuffers.get(voice.id);
    if (buf && voice.fx?.length) createVoiceFxRack(voice, rate).applyStereoFx(buf, channels);
  }
  for (const voice of orderDuckVoices(voices)) {
    if (!voice.duck) continue;
    const target = voiceBuffers.get(voice.id);
    const trigger = voiceBuffers.get(voice.duck.by);
    if (!target || !trigger) continue;
    const env = computeDuckEnvelope(trigger, channels, rate, voice.duck.releaseMs);
    applyDuckEnvelope(target, channels, env, voice.duck.amount);
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
  const rate = recipe.sample_rate;
  const channels = recipe.channels ?? 1;
  const totalFrames = frame(recipe.duration);
  const loopFrames =
    recipe.playback.kind === 'loop'
      ? frame(recipe.playback.end) - frame(recipe.playback.start) - frame(recipe.playback.crossfade)
      : undefined;
  const voiceBuffers = new Map<string, Float64Array>();
  for (const event of schedule(recipe, variant)) {
    let voiceBuf = voiceBuffers.get(event.voice.id);
    if (!voiceBuf) {
      voiceBuf = new Float64Array(totalFrames * channels);
      voiceBuffers.set(event.voice.id, voiceBuf);
    }
    renderEventIntoVoice(event, rate, channels, totalFrames, loopFrames, voiceBuf);
  }
  applyVoiceFxAndDucking(recipe.voices, voiceBuffers, channels, rate);
  const result = new Float64Array(totalFrames * channels);
  for (const buf of voiceBuffers.values()) {
    for (let i = 0; i < result.length; i++) result[i] = result[i]! + buf[i]!;
  }
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
  policy: MasterSpec,
  channels: 1 | 2 = 1,
  rate = 48000,
  loop = false,
): Float64Array => {
  const result = applyMasterBus(pcm, policy, channels, rate, loop);
  const ceiling = 10 ** (policy.peakDb / 20);
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
