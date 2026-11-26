export type CurveEasing = 'linear' | 'smooth' | 'ease_in' | 'ease_out' | 'ease_in_out' | 'snap';

export interface CurvePoint {
  readonly at: number;
  readonly value: number;
  readonly easing?: CurveEasing;
}

export interface Curve {
  readonly domain: 'linear' | 'log';
  readonly interpolation: 'linear' | 'smooth';
  readonly points: readonly CurvePoint[];
}

export type Control = number | Curve;

export type EnvelopeControl =
  | {
      readonly env: 'ad';
      readonly attack: number;
      readonly peak?: number;
      readonly curve?: 'linear' | 'exp';
    }
  | {
      readonly env: 'adsr';
      readonly attack: number;
      readonly decay: number;
      readonly sustain: number;
      readonly release: number;
      readonly peak?: number;
      readonly curve?: 'linear' | 'exp';
    };

export type GainControl = Control | EnvelopeControl;

export type SoundProfile = 'impact' | 'foley' | 'creature' | 'magic' | 'ui' | 'ambient';
export const SOUND_PROFILES: readonly SoundProfile[] = Object.freeze([
  'impact',
  'foley',
  'creature',
  'magic',
  'ui',
  'ambient',
]);

export type MaterialPreset =
  | 'steel'
  | 'iron'
  | 'bronze'
  | 'bell'
  | 'wood'
  | 'stone'
  | 'glass'
  | 'ceramic'
  | 'bone'
  | 'leather';

export const MATERIAL_PRESETS: readonly MaterialPreset[] = Object.freeze([
  'steel',
  'iron',
  'bronze',
  'bell',
  'wood',
  'stone',
  'glass',
  'ceramic',
  'bone',
  'leather',
]);

export type GranularTexture =
  'ember' | 'gravel' | 'water' | 'foliage' | 'wind' | 'spark' | 'bubble';

export const GRANULAR_TEXTURES: readonly GranularTexture[] = Object.freeze([
  'ember',
  'gravel',
  'water',
  'foliage',
  'wind',
  'spark',
  'bubble',
]);

export type SpacePreset =
  | 'dry_close'
  | 'timber_room'
  | 'stone_hall'
  | 'small_chamber'
  | 'courtyard'
  | 'cavern'
  | 'ethereal';

export const SPACE_PRESETS: readonly SpacePreset[] = Object.freeze([
  'dry_close',
  'timber_room',
  'stone_hall',
  'small_chamber',
  'courtyard',
  'cavern',
  'ethereal',
]);

export interface NoiseSource {
  readonly kind: 'noise';
  readonly color: 'white' | 'pink' | 'brown';
}

export interface MaterialSource {
  readonly kind: 'material';
  readonly material: MaterialPreset;
  readonly pitch: Control;
  readonly size?: number;
  readonly hardness?: number;
  readonly damping?: number;
  readonly brightness?: number;
  readonly modes?: number;
  readonly strike?: 'mallet' | 'scrape' | 'bounce';
  readonly bounces?: number;
  readonly twinBeat?: number;
  readonly splash?: number;
  readonly stereoSpread?: number;
}

export interface GranularSource {
  readonly kind: 'granular';
  readonly texture: GranularTexture;
  readonly density: Control;
  readonly grainMs?: number;
  readonly pitch?: Control;
  readonly spread?: number;
  readonly burstiness?: number;
  readonly turbulence?: number;
  readonly stereoWidth?: number;
  readonly itdMs?: number;
}

export interface OscSource {
  readonly kind: 'osc';
  readonly waveform: 'sine' | 'triangle' | 'saw' | 'square' | 'pulse';
  readonly pitch: Control;
  readonly pulseWidth?: Control;
  readonly unison?: number;
  readonly detuneCents?: number;
}

export interface FmSource {
  readonly kind: 'fm';
  readonly pitch: Control;
  readonly ratio: number;
  readonly index: Control;
  readonly vibratoHz?: number;
  readonly vibratoCents?: number;
}

export interface VocalSource {
  readonly kind: 'vocal';
  readonly pitch: Control;
  readonly vowels?: string;
  readonly formants?: readonly Control[];
  readonly bandwidths?: readonly number[];
  readonly breath?: number;
  readonly jitter?: number;
  readonly roughness?: number;
  readonly growl?: number;
  readonly chest?: number;
  readonly nasal?: number;
  readonly rattle?: number;
}

export interface ChirpSource {
  readonly kind: 'chirp';
  readonly pitch: Control;
  readonly trillHz?: number;
  readonly trillCents?: number;
  readonly trillDepth?: number;
  readonly breath?: number;
  readonly jitterCents?: number;
  readonly brightness: Control;
}

export interface WhooshSource {
  readonly kind: 'whoosh';
  readonly velocity: Control;
  readonly thickness?: number;
  readonly doppler?: number;
  readonly sweepPan?: Control;
  readonly noiseTone?: number;
}

export type WaveguideModel = 'string' | 'blade' | 'creak' | 'pipe';

export interface WaveguideSource {
  readonly kind: 'waveguide';
  readonly model: WaveguideModel;
  readonly pitch: Control;
  readonly damping?: number;
  readonly stiffness?: number;
  readonly bowPressure?: number;
  readonly brightness?: number;
}

export interface FilterSpec {
  readonly kind: 'lowpass' | 'highpass' | 'bandpass' | 'notch';
  readonly cutoff: Control;
  readonly q?: Control;
}

export interface VoiceEqSpec {
  readonly low?: { readonly hz: number; readonly db: number };
  readonly mid?: {
    readonly hz: number;
    readonly db: number;
    readonly q?: number;
  };
  readonly high?: { readonly hz: number; readonly db: number };
}

export type VoiceDriveSpec =
  | number
  | {
      readonly amount: number;
      readonly mode: 'tape' | 'tube' | 'grit' | 'fold';
    };

export type VoiceFxItem =
  | {
      readonly kind: 'chorus';
      readonly mix: number;
      readonly rate?: number;
      readonly depth?: number;
    }
  | {
      readonly kind: 'phaser';
      readonly mix: number;
      readonly rate?: number;
      readonly stages?: number;
    }
  | {
      readonly kind: 'delay';
      readonly mix: number;
      readonly timeMs: number;
      readonly feedback?: number;
      readonly damping?: number;
      readonly pingPong?: boolean;
    }
  | {
      readonly kind: 'shimmer';
      readonly mix: number;
      readonly feedback?: number;
      readonly shiftSemitones?: number;
    };

export interface VoiceDuckSpec {
  readonly by: string;
  readonly amount: number;
  readonly releaseMs: number;
}

export interface VoiceDriftSpec {
  readonly rate?: number;
  readonly depth: number;
  readonly target: 'gain' | 'cutoff' | 'pitch' | 'pan';
  readonly seed?: number;
}

export interface SpaceSpec {
  readonly preset?: SpacePreset;
  readonly mix?: number;
  readonly decay?: number;
  readonly damping?: number;
  readonly size?: number;
  readonly preDelayMs?: number;
  readonly width?: number;
}

export interface MasterSpec {
  readonly gainDb: number;
  readonly peakDb: number;
  readonly targetLufs?: number;
  readonly punch?: number;
  readonly warmth?: number;
  readonly air?: number;
  readonly glue?: number;
  readonly width?: number;
  readonly limit?: boolean;
}

export type SoundSource =
  | NoiseSource
  | OscSource
  | FmSource
  | VocalSource
  | ChirpSource
  | MaterialSource
  | GranularSource
  | WhooshSource
  | WaveguideSource;

export interface SoundVoice {
  readonly id: string;
  readonly source: SoundSource;
  readonly gain: GainControl;
  readonly highpass?: Control;
  readonly lowpass?: Control;
  readonly filter?: FilterSpec;
  readonly eq?: VoiceEqSpec;
  readonly drive?: VoiceDriveSpec;
  readonly fx?: readonly VoiceFxItem[];
  readonly pan?: Control;
  readonly duck?: VoiceDuckSpec;
  readonly drift?: VoiceDriftSpec;
}

export type Range = readonly [number, number];

export interface SoundVary {
  readonly timing?: Range;
  readonly pitchCents?: Range;
  readonly gain?: Range;
  readonly duration?: Range;
}

export interface SoundStep {
  readonly id: string;
  readonly voice: string;
  readonly at: number;
  readonly duration: number;
  readonly gain?: number;
  readonly pitchCents?: number;
  readonly vary?: SoundVary;
}

export interface SoundSequence {
  readonly id: string;
  readonly start: number;
  readonly repeat?: { readonly count: number; readonly period: number };
  readonly steps: readonly SoundStep[];
}

export interface SoundVariant {
  readonly id: string;
  readonly seed: number;
}

export type SoundPlayback =
  | { readonly kind: 'oneshot' }
  | {
      readonly kind: 'loop';
      readonly startFrame: 0;
      readonly endFrame: number;
    };

export interface SoundRecipe {
  readonly id: string;
  readonly profile: SoundProfile;
  readonly duration: number;
  readonly sample_rate: 48000;
  readonly channels?: 1 | 2;
  readonly seed: number;
  readonly variants: readonly SoundVariant[];
  readonly space?: SpaceSpec;
  readonly output: MasterSpec;
  readonly voices: readonly SoundVoice[];
  readonly sequences: readonly SoundSequence[];
  readonly playback:
    | { readonly kind: 'oneshot' }
    | {
        readonly kind: 'loop';
        readonly start: number;
        readonly end: number;
        readonly crossfade: number;
      };
}

export interface SoundProduct {
  readonly id: string;
  readonly profile: SoundProfile;
  readonly variant: string;
  readonly wav: Uint8Array;
  readonly frames: number;
  readonly rawFrames: number;
  readonly sample_rate: 48000;
  readonly channels: 1 | 2;
  readonly peak: number;
  readonly rms: number;
  readonly dc: number;
  readonly playback: SoundPlayback;
  readonly seamDelta: number;
  readonly maxAdjacentDelta: number;
}
