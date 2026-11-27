import type {
  ChirpSource,
  FmSource,
  GranularSource,
  MaterialSource,
  NoiseSource,
  OscSource,
  SoundSource,
  VocalSource,
  WaveguideSource,
  WhooshSource,
} from './contract';
import { createChirp } from './chirp';
import { createFm } from './fm';
import { createGranular } from './granular';
import { createMaterial } from './material';
import { createNoise } from './noise';
import { createOsc } from './osc';
import { random } from './random';
import type { Event } from './schedule';
import { createVoice } from './voice';
import { createWaveguide } from './waveguide';
import { createWhoosh } from './whoosh';

export type StereoSampler = (i: number, outLR: Float64Array) => void;

export type BipolarDomain = 'noise' | 'breath' | 'jitter' | 'trill-phase';

export interface SourceFactoryContext {
  readonly event: Event;
  readonly rate: number;
  readonly channels: 1 | 2;
  readonly invLen: number;
  readonly bipolar: (domain: BipolarDomain) => () => number;
}

export type SourceFactory = (source: SoundSource, ctx: SourceFactoryContext) => StereoSampler;

const defineSourceFactory = <K extends SoundSource['kind']>(
  factory: (
    source: Extract<SoundSource, { readonly kind: K }>,
    ctx: SourceFactoryContext,
  ) => StereoSampler,
): SourceFactory => factory as SourceFactory;

const createOscSampler = (source: OscSource, ctx: SourceFactoryContext): StereoSampler => {
  const osc = createOsc(source, ctx.rate, ctx.event.pitch);
  return (i, outLR) => osc(i * ctx.invLen, outLR);
};

const createFmSampler = (source: FmSource, ctx: SourceFactoryContext): StereoSampler => {
  const fm = createFm(source, ctx.event.frames, ctx.event.pitch);
  return (i, outLR) => fm(i, outLR);
};

const createVocalSampler = (source: VocalSource, ctx: SourceFactoryContext): StereoSampler => {
  const vocal = createVoice(
    source,
    ctx.rate,
    ctx.event.pitch,
    ctx.bipolar('jitter'),
    ctx.bipolar('breath'),
  );
  return (i, outLR) => vocal(i * ctx.invLen, outLR);
};

const createChirpSampler = (source: ChirpSource, ctx: SourceFactoryContext): StereoSampler => {
  const chirp = createChirp(
    source,
    ctx.rate,
    ctx.event.pitch,
    ctx.bipolar('jitter'),
    ctx.bipolar('breath'),
    ctx.bipolar('trill-phase'),
  );
  return (i, outLR) => chirp(i / ctx.rate, i * ctx.invLen, outLR);
};

const createMaterialSampler = (source: MaterialSource, ctx: SourceFactoryContext): StereoSampler =>
  createMaterial(source, ctx.event.frames, ctx.event.pitch, ctx.event.stream('excitation'));

const createGranularSampler = (source: GranularSource, ctx: SourceFactoryContext): StereoSampler =>
  createGranular(
    source,
    ctx.rate,
    ctx.event.frames,
    ctx.event.pitch,
    ctx.event.stream('grain'),
    ctx.event.stream('turbulence'),
  );

const createWhooshSampler = (source: WhooshSource, ctx: SourceFactoryContext): StereoSampler =>
  createWhoosh(source, ctx.rate, ctx.event.frames, ctx.event.pitch, ctx.event.stream('vortex'));

const createWaveguideSampler = (
  source: WaveguideSource,
  ctx: SourceFactoryContext,
): StereoSampler =>
  createWaveguide(
    source,
    ctx.rate,
    ctx.event.frames,
    ctx.event.pitch,
    ctx.event.stream('excitation'),
  );

const createNoiseSampler = (source: NoiseSource, ctx: SourceFactoryContext): StereoSampler => {
  const noiseL = ctx.event.stream('noise');
  const noiseR =
    ctx.channels === 2
      ? random((Math.floor(noiseL() * 0xffffffff) ^ 0x9e3779b9) >>> 0 || 1)
      : undefined;
  const noise = createNoise(source, noiseL, noiseR);
  return (_i, outLR) => noise(outLR);
};

/** Closed immutable strategy registry mapping each sound source kind to its sampler factory. */
export const SOURCE_FACTORIES: Readonly<Record<SoundSource['kind'], SourceFactory>> = Object.freeze(
  {
    osc: defineSourceFactory<'osc'>(createOscSampler),
    fm: defineSourceFactory<'fm'>(createFmSampler),
    vocal: defineSourceFactory<'vocal'>(createVocalSampler),
    chirp: defineSourceFactory<'chirp'>(createChirpSampler),
    material: defineSourceFactory<'material'>(createMaterialSampler),
    granular: defineSourceFactory<'granular'>(createGranularSampler),
    whoosh: defineSourceFactory<'whoosh'>(createWhooshSampler),
    waveguide: defineSourceFactory<'waveguide'>(createWaveguideSampler),
    noise: defineSourceFactory<'noise'>(createNoiseSampler),
  },
);

/** Instantiate the stereo sample generator for a scheduled sound event. */
export const createSourceSampler = (event: Event, rate: number, channels: 1 | 2): StereoSampler => {
  const source = event.voice.source;
  const invLen = 1 / Math.max(1, event.frames - 1);
  const bipolar = (domain: BipolarDomain) => {
    const r = event.stream(domain);
    return () => r() * 2 - 1;
  };
  return SOURCE_FACTORIES[source.kind](source, { event, rate, channels, invLen, bipolar });
};
