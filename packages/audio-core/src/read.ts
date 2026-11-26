import {
  SOUND_PROFILES,
  type SoundRecipe,
  type SoundSequence,
  type SoundStep,
  type SoundVary,
  type SoundVoice,
} from './contract';
import { validatePlan, type SoundBudget } from './plan';
import { readControl, readGainControl, readSource, readVoiceFilter } from './readSource';
import { bool, choice, closed, fail, freeze, id, list, number, ordered } from './validate';

const VARY_BOUNDS = {
  timing: [-0.5, 0.5, 0, 0],
  pitchCents: [-1200, 1200, 0, 0],
  gain: [0, 2, 1, 1],
  duration: [0.25, 4, 1, 1],
} as const;

const readVaryRange = (
  vary: Record<string, unknown>,
  key: keyof typeof VARY_BOUNDS,
  at: string,
): readonly [number, number] => {
  const [min, max, defLo, defHi] = VARY_BOUNDS[key];
  if (vary[key] === undefined) return [defLo, defHi];
  const range = list(vary[key], 2, 2, `${at}.${key}`);
  const a = number(range[0], min, max, `${at}.${key}[0]`);
  const b = number(range[1], min, max, `${at}.${key}[1]`);
  if (a > b) fail(`${at}.${key}`, `minimum ${a} exceeds maximum ${b}`);
  return [a, b];
};

const readVary = (raw: unknown, at: string): Required<SoundVary> => {
  if (raw === undefined) {
    return { timing: [0, 0], pitchCents: [0, 0], gain: [1, 1], duration: [1, 1] };
  }
  const vary = closed(raw, [], at, ['timing', 'pitchCents', 'gain', 'duration']);
  return {
    timing: readVaryRange(vary, 'timing', at),
    pitchCents: readVaryRange(vary, 'pitchCents', at),
    gain: readVaryRange(vary, 'gain', at),
    duration: readVaryRange(vary, 'duration', at),
  };
};

const readStep = (
  rawStep: unknown,
  at: string,
  steps: Set<string>,
  voices: Set<string>,
  referenced: Set<string>,
): SoundStep => {
  const step = closed(rawStep, ['id', 'voice', 'at', 'duration'], at, [
    'gain',
    'pitchCents',
    'vary',
  ]);
  const stepId = id(step.id, at + '.id', steps);
  const voice = id(step.voice, at + '.voice');
  if (!voices.has(voice)) fail(at + '.voice', `unknown voice ${voice}`);
  referenced.add(voice);
  return {
    id: stepId,
    voice,
    at: number(step.at, 0, 30, at + '.at'),
    duration: number(step.duration, 0.02, 30, at + '.duration'),
    gain: step.gain === undefined ? 1 : number(step.gain, 0, 2, at + '.gain'),
    pitchCents:
      step.pitchCents === undefined ? 0 : number(step.pitchCents, -1200, 1200, at + '.pitchCents'),
    vary: readVary(step.vary, at + '.vary'),
  };
};

const readSequences = (
  rawSequences: unknown,
  voices: Set<string>,
): { readonly sequences: readonly SoundSequence[]; readonly referenced: Set<string> } => {
  const ids = new Set<string>();
  const referenced = new Set<string>();
  const sequences = ordered(list(rawSequences, 1, 32, 'recipe.sequences')).map(
    ({ raw, index: i }) => {
      const p = `recipe.sequences[${i}]`;
      const s = closed(raw, ['id', 'start', 'steps'], p, ['repeat']);
      const seqId = id(s.id, p + '.id', ids);
      const start = number(s.start, 0, 30, p + '.start');
      const r =
        s.repeat === undefined
          ? { count: 1, period: 0 }
          : closed(s.repeat, ['count', 'period'], p + '.repeat');
      const count = number(r.count, 1, 64, p + '.repeat.count', true);
      const period = number(
        r.period,
        count === 1 ? 0 : 1 / 48000,
        count === 1 ? 0 : 30,
        p + '.repeat.period',
      );
      const stepIds = new Set<string>();
      const steps = ordered(list(s.steps, 1, 32, p + '.steps')).map(({ raw: rawStep, index: j }) =>
        readStep(rawStep, `${p}.steps[${j}]`, stepIds, voices, referenced),
      );
      return { id: seqId, start, repeat: { count, period }, steps };
    },
  );
  return { sequences, referenced };
};

const readPlayback = (raw: unknown, duration: number): SoundRecipe['playback'] => {
  const playback = raw as Record<string, unknown> | null;
  if (playback?.kind === 'oneshot') {
    closed(playback, ['kind'], 'recipe.playback');
    return { kind: 'oneshot' };
  }
  if (playback?.kind === 'loop') {
    closed(playback, ['kind', 'start', 'end', 'crossfade'], 'recipe.playback');
    return {
      kind: 'loop',
      start: number(playback.start, 0, duration, 'recipe.playback.start'),
      end: number(playback.end, 0, duration, 'recipe.playback.end'),
      crossfade: number(playback.crossfade, 0.002, 1, 'recipe.playback.crossfade'),
    };
  }
  return fail('recipe.playback.kind', 'expected oneshot or loop');
};

const readVoiceEntry = (
  raw: unknown,
  i: number,
  channels: 1 | 2,
  voiceIds: Set<string>,
): SoundVoice => {
  const p = `recipe.voices[${i}]`;
  const v = closed(raw, ['id', 'source', 'gain'], p, [
    'highpass',
    'lowpass',
    'filter',
    'drive',
    'pan',
  ]);
  const voice: {
    id: string;
    source: SoundVoice['source'];
    gain: SoundVoice['gain'];
    highpass?: SoundVoice['highpass'];
    lowpass?: SoundVoice['lowpass'];
    filter?: SoundVoice['filter'];
    drive?: number;
    pan?: number;
  } = {
    id: id(v.id, p + '.id', voiceIds),
    source: readSource(v.source, p + '.source'),
    gain: readGainControl(v.gain, p + '.gain'),
  };
  if (v.highpass !== undefined)
    voice.highpass = readControl(v.highpass, 10, 10000, p + '.highpass');
  if (v.lowpass !== undefined) voice.lowpass = readControl(v.lowpass, 20, 18000, p + '.lowpass');
  if (v.filter !== undefined) voice.filter = readVoiceFilter(v.filter, p + '.filter');
  if (v.drive !== undefined) voice.drive = number(v.drive, 0, 10, p + '.drive');
  if (v.pan !== undefined) {
    const pan = number(v.pan, -1, 1, p + '.pan');
    if (channels === 1 && pan !== 0) fail(p + '.pan', 'pan requires channels = 2');
    voice.pan = pan;
  }
  return voice;
};

const readVoices = (
  rawVoices: unknown,
  channels: 1 | 2,
): { readonly voiceIds: Set<string>; readonly voices: readonly SoundVoice[] } => {
  const voiceIds = new Set<string>();
  const rawList = list(rawVoices, 1, 16, 'recipe.voices');
  const voices = new Array<SoundVoice>(rawList.length);
  ordered(rawList).forEach(({ raw, index: i }) => {
    voices[i] = readVoiceEntry(raw, i, channels, voiceIds);
  });
  return { voiceIds, voices };
};

const readSpace = (raw: unknown): SoundRecipe['space'] | undefined => {
  if (raw === undefined) return undefined;
  const s = closed(raw, ['mix', 'decay', 'damping', 'size'], 'recipe.space');
  return {
    mix: number(s.mix, 0, 0.6, 'recipe.space.mix'),
    decay: number(s.decay, 0.03, 1.5, 'recipe.space.decay'),
    damping: number(s.damping, 1000, 14000, 'recipe.space.damping'),
    size: number(s.size, 0.2, 2, 'recipe.space.size'),
  };
};

const ROOT_REQUIRED = [
  'id',
  'profile',
  'duration',
  'sampleRate',
  'seed',
  'variants',
  'output',
  'voices',
  'sequences',
  'playback',
] as const;

const readRecipeOutput = (raw: unknown): SoundRecipe['output'] => {
  const output = closed(raw, ['gainDb', 'peakDb'], 'recipe.output', ['softClip']);
  const gainDb = number(output.gainDb, -48, 24, 'recipe.output.gainDb');
  const peakDb = number(output.peakDb, -12, -1, 'recipe.output.peakDb');
  const softClip =
    output.softClip !== undefined ? bool(output.softClip, 'recipe.output.softClip') : undefined;
  return { gainDb, peakDb, ...(softClip !== undefined ? { softClip } : {}) };
};

const readRecipeVariants = (rawVariants: unknown): SoundRecipe['variants'] => {
  const variants = new Set<string>();
  return ordered(list(rawVariants, 1, 8, 'recipe.variants')).map(({ raw, index: i }) => {
    const p = `recipe.variants[${i}]`;
    const v = closed(raw, ['id', 'seed'], p);
    return {
      id: id(v.id, p + '.id', variants),
      seed: number(v.seed, 1, 0xffffffff, p + '.seed', true),
    };
  });
};

export const readRecipeWithBudget = (
  input: unknown,
): { readonly recipe: SoundRecipe; readonly budget: SoundBudget } => {
  const root = closed(input, ROOT_REQUIRED, 'recipe', ['channels', 'space']);
  const recipeId = id(root.id, 'recipe.id');
  const profile = choice(root.profile, SOUND_PROFILES, 'recipe.profile');
  const duration = number(root.duration, 0.05, 30, 'recipe.duration');
  number(root.sampleRate, 48000, 48000, 'recipe.sampleRate');
  const channels =
    root.channels === undefined
      ? 1
      : (number(root.channels, 1, 2, 'recipe.channels', true) as 1 | 2);
  const seed = number(root.seed, 1, 0xffffffff, 'recipe.seed', true);
  const space = readSpace(root.space);
  const { voiceIds, voices } = readVoices(root.voices, channels);
  const { sequences, referenced } = readSequences(root.sequences, voiceIds);
  for (const voice of voiceIds) {
    if (!referenced.has(voice)) {
      fail(
        `recipe.voices[${voices.findIndex((v) => v.id === voice)}].id`,
        `unreferenced voice ${voice}`,
      );
    }
  }
  const playback = readPlayback(root.playback, duration);
  const normalized: SoundRecipe = {
    id: recipeId,
    profile,
    duration,
    sampleRate: 48000,
    channels,
    seed,
    ...(space !== undefined ? { space } : {}),
    variants: readRecipeVariants(root.variants),
    output: readRecipeOutput(root.output),
    voices,
    sequences,
    playback,
  };
  const budget = validatePlan(normalized);
  return { recipe: freeze(normalized) as SoundRecipe, budget };
};

export const readRecipe = (input: unknown): SoundRecipe => readRecipeWithBudget(input).recipe;
