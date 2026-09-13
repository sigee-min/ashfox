import type { SoundRecipe } from './contract';
import { closed, fail, freeze, id, list, number, ordered } from './validate';
import { readControl, readSource } from './readSource';
import { validatePlan } from './plan';
export const readRecipe = (input: unknown): SoundRecipe => {
  const root = closed(input, ['id', 'duration', 'sampleRate', 'seed', 'variants', 'output', 'voices', 'sequences', 'playback'], 'recipe');
  id(root.id, 'recipe.id'); number(root.duration, .05, 30, 'recipe.duration');
  number(root.sampleRate, 48000, 48000, 'recipe.sampleRate'); number(root.seed, 1, 0xffffffff, 'recipe.seed', true);
  const output = closed(root.output, ['gainDb', 'peakDb'], 'recipe.output');
  number(output.gainDb, -48, 24, 'recipe.output.gainDb'); number(output.peakDb, -12, -1, 'recipe.output.peakDb');
  const variants = new Set<string>();
  ordered(list(root.variants, 1, 8, 'recipe.variants')).forEach(({ raw, index: i }) => {
    const p = `recipe.variants[${i}]`, v = closed(raw, ['id', 'seed'], p);
    id(v.id, p + '.id', variants); number(v.seed, 1, 0xffffffff, p + '.seed', true);
  });
  const voices = new Set<string>();
  ordered(list(root.voices, 1, 16, 'recipe.voices')).forEach(({ raw, index: i }) => {
    const p = `recipe.voices[${i}]`, v = closed(raw, ['id', 'source', 'gain', 'highpass', 'lowpass'], p);
    id(v.id, p + '.id', voices); readControl(v.gain, 0, 2, p + '.gain', true);
    readControl(v.highpass, 10, 10000, p + '.highpass'); readControl(v.lowpass, 20, 16000, p + '.lowpass'); readSource(v.source, p + '.source');
  });
  const sequences = new Set<string>(), referenced = new Set<string>();
  ordered(list(root.sequences, 1, 32, 'recipe.sequences')).forEach(({ raw, index: i }) => {
    const p = `recipe.sequences[${i}]`, s = closed(raw, ['id', 'start', 'repeat', 'steps'], p);
    id(s.id, p + '.id', sequences); number(s.start, 0, 30, p + '.start');
    const r = closed(s.repeat, ['count', 'period'], p + '.repeat');
    const count = number(r.count, 1, 64, p + '.repeat.count', true);
    number(r.period, count === 1 ? 0 : 1 / 48000, count === 1 ? 0 : 30, p + '.repeat.period');
    const steps = new Set<string>();
    ordered(list(s.steps, 1, 32, p + '.steps')).forEach(({ raw: rawStep, index: j }) => {
      const at = `${p}.steps[${j}]`, step = closed(rawStep, ['id', 'voice', 'at', 'duration', 'gain', 'pitchCents', 'vary'], at);
      id(step.id, at + '.id', steps); const voice = id(step.voice, at + '.voice');
      if (!voices.has(voice)) fail(at + '.voice', `unknown voice ${voice}`); referenced.add(voice);
      number(step.at, 0, 30, at + '.at'); number(step.duration, .02, 30, at + '.duration');
      number(step.gain, 0, 2, at + '.gain'); number(step.pitchCents, -1200, 1200, at + '.pitchCents');
      const vary = closed(step.vary, ['timing', 'pitchCents', 'gain', 'duration'], at + '.vary');
      for (const [key, min, max] of [['timing', -.5, .5], ['pitchCents', -1200, 1200], ['gain', 0, 2], ['duration', .25, 4]] as const) {
        const range = list(vary[key], 2, 2, `${at}.vary.${key}`);
        const a = number(range[0], min, max, `${at}.vary.${key}[0]`), b = number(range[1], min, max, `${at}.vary.${key}[1]`);
        if (a > b) fail(`${at}.vary.${key}`, `minimum ${a} exceeds maximum ${b}`);
      }
    });
  });
  for (const voice of voices) if (!referenced.has(voice)) fail(`recipe.voices[${(root.voices as Record<string, unknown>[]).findIndex(v => v.id === voice)}].id`, `unreferenced voice ${voice}`);
  const playback = root.playback as Record<string, unknown> | null;
  if (playback?.kind === 'oneshot') closed(playback, ['kind'], 'recipe.playback');
  else if (playback?.kind === 'loop') {
    closed(playback, ['kind', 'start', 'end', 'crossfade'], 'recipe.playback');
    number(playback.start, 0, root.duration as number, 'recipe.playback.start');
    number(playback.end, 0, root.duration as number, 'recipe.playback.end'); number(playback.crossfade, .002, 1, 'recipe.playback.crossfade');
  } else fail('recipe.playback.kind', 'expected oneshot or loop');
  const recipe = input as SoundRecipe;
  validatePlan(recipe);
  return freeze(JSON.parse(JSON.stringify(root))) as SoundRecipe;
};
