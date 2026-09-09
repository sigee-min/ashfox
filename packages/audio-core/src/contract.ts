export interface NoiseSource { readonly kind: 'noise' }
export interface FmSource {
  readonly kind: 'fm'; readonly pitch: readonly [number, number];
  readonly ratio: number; readonly index: number; readonly sweepSeconds: number;
  readonly vibratoHz: number; readonly vibratoCents: number;
}
export interface VocalSource {
  readonly kind: 'vocal'; readonly pitch: readonly [number, number]; readonly sweepSeconds: number;
  readonly formants: readonly number[]; readonly bandwidths: readonly number[];
  readonly breath: number; readonly jitter: number; readonly roughness: number;
}
export interface SoundLayer {
  readonly id: string; readonly source: NoiseSource | FmSource | VocalSource;
  readonly start: number; readonly duration: number; readonly gain: number;
  readonly attack: number; readonly release: number; readonly highpass: number; readonly lowpass: number;
}
export interface SoundRecipe {
  readonly format: 'ashfox-sound'; readonly version: 1; readonly id: string;
  readonly duration: number; readonly sampleRate: 48000; readonly seed: number;
  readonly variants: readonly { readonly id: string; readonly seed: number }[];
  readonly output: { readonly rmsDb: number; readonly peakDb: number };
  readonly layers: readonly SoundLayer[];
}
export interface SoundProduct {
  readonly id: string; readonly variant: string; readonly wav: Uint8Array;
  readonly frames: number; readonly sampleRate: 48000; readonly channels: 1;
  readonly peak: number; readonly rms: number; readonly dc: number;
}
