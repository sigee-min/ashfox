export interface Curve {
  readonly domain: 'linear' | 'log'; readonly interpolation: 'linear' | 'smooth';
  readonly points: readonly { readonly at: number; readonly value: number }[];
}
export type Control = number | Curve;
export interface NoiseSource { readonly kind: 'noise' }
export interface FmSource {
  readonly kind: 'fm'; readonly pitch: Control; readonly ratio: number; readonly index: Control;
  readonly vibratoHz: number; readonly vibratoCents: number;
}
export interface VocalSource {
  readonly kind: 'vocal'; readonly pitch: Control;
  readonly formants: readonly number[]; readonly bandwidths: readonly number[];
  readonly breath: number; readonly jitter: number; readonly roughness: number;
}
export interface ChirpSource {
  readonly kind: 'chirp'; readonly pitch: Control;
  readonly trillHz: number; readonly trillCents: number; readonly trillDepth: number;
  readonly breath: number; readonly jitterCents: number; readonly brightness: Control;
}
export interface ResonatorSource {
  readonly kind: 'resonator';
  readonly excitation: { readonly kind: 'impulse' } | { readonly kind: 'noise'; readonly duration: number };
  readonly modes: readonly { readonly id: string; readonly hz: number; readonly decay: number; readonly gain: number }[];
}
export interface SoundVoice {
  readonly id: string; readonly source: NoiseSource | FmSource | VocalSource | ChirpSource | ResonatorSource;
  readonly gain: Control; readonly highpass: Control; readonly lowpass: Control;
}
export type Range = readonly [number, number];
export interface SoundStep {
  readonly id: string; readonly voice: string; readonly at: number; readonly duration: number;
  readonly gain: number; readonly pitchCents: number;
  readonly vary: { readonly timing: Range; readonly pitchCents: Range; readonly gain: Range; readonly duration: Range };
}
export interface SoundSequence {
  readonly id: string; readonly start: number; readonly repeat: { readonly count: number; readonly period: number };
  readonly steps: readonly SoundStep[];
}
export interface SoundVariant { readonly id: string; readonly seed: number }
export type SoundPlayback = { readonly kind: 'oneshot' } | { readonly kind: 'loop'; readonly startFrame: 0; readonly endFrame: number };
export interface SoundRecipe {
  readonly id: string; readonly duration: number; readonly sampleRate: 48000; readonly seed: number;
  readonly variants: readonly SoundVariant[]; readonly output: { readonly gainDb: number; readonly peakDb: number };
  readonly voices: readonly SoundVoice[]; readonly sequences: readonly SoundSequence[];
  readonly playback: { readonly kind: 'oneshot' } | { readonly kind: 'loop'; readonly start: number; readonly end: number; readonly crossfade: number };
}
export interface SoundProduct {
  readonly id: string; readonly variant: string; readonly wav: Uint8Array;
  readonly frames: number; readonly rawFrames: number; readonly sampleRate: 48000; readonly channels: 1;
  readonly peak: number; readonly rms: number; readonly dc: number; readonly playback: SoundPlayback;
  readonly seamDelta: number; readonly maxAdjacentDelta: number;
}
