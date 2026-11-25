import type { SoundRecipe, SoundVoice } from './contract';
import { bounds, controls, evaluate, frame } from './curve';
import { fail } from './validate';
const weight = (voice: SoundVoice): number => {
  const s = voice.source;
  return s.kind === 'resonator'
    ? 4 + 4 * s.modes.length
    : { noise: 1, fm: 128, chirp: 8, vocal: 16 }[s.kind];
};
export interface SoundBudget {
  readonly eventFrames: number;
  readonly weightedFrames: number;
  readonly outputFrames: number;
}
interface VoiceEntry {
  readonly voice: SoundVoice;
  readonly path: string;
}

const validateVoices = (recipe: SoundRecipe): Map<string, VoiceEntry> => {
  const voices = new Map(
    recipe.voices.map((voice, i) => [voice.id, { voice, path: `recipe.voices[${i}]` }]),
  );
  let knots = 0;
  for (const { voice, path } of [...voices.values()].sort((a, b) =>
    a.voice.id < b.voice.id ? -1 : 1,
  )) {
    if (bounds(voice.highpass)[1] >= bounds(voice.lowpass)[0])
      fail(
        path + '.highpass',
        'maximum highpass must be below minimum lowpass; separate the entire cutoff ranges',
      );
    for (const [, c] of controls(voice)) if (typeof c !== 'number') knots += c.points.length;
  }
  if (knots > 1024) fail('recipe.voices', `curve knot limit 1024; received ${knots}`);
  return voices;
};

const validateLoopPlayback = (playback: SoundRecipe['playback']): void => {
  if (playback.kind !== 'loop') return;
  const length = frame(playback.end) - frame(playback.start);
  const overlap = frame(playback.crossfade);
  if (length <= 0) fail('recipe.playback.end', 'loop end must exceed start after quantization');
  if (overlap > Math.min(48000, Math.floor(length / 4)))
    fail(
      'recipe.playback.crossfade',
      `maximum overlap ${Math.min(48000, Math.floor(length / 4))} frames; received ${overlap}`,
    );
  if (length - overlap < 2400)
    fail('recipe.playback', `minimum delivered length 2400 frames; received ${length - overlap}`);
};

const insideWindow = (playback: SoundRecipe['playback'], a: number, b: number, framed: boolean) => {
  if (playback.kind === 'oneshot') return true;
  const start = framed ? frame(playback.start) : playback.start;
  const end = framed ? frame(playback.end) : playback.end;
  return b > start && a < end;
};

const validateStepTimingAndKnots = (
  recipe: SoundRecipe,
  info: VoiceEntry,
  step: SoundRecipe['sequences'][number]['steps'][number],
  sequence: SoundRecipe['sequences'][number],
  iteration: number,
  p: string,
): { earliest: number; latest: number; shortest: number; longest: number } => {
  const context = `sequence ${sequence.id}, step ${step.id}, iteration ${iteration}`;
  const nominal = sequence.start + iteration * sequence.repeat.period + step.at;
  const earliest = nominal + step.vary.timing[0];
  const latest = nominal + step.vary.timing[1];
  const shortest = step.duration * step.vary.duration[0];
  const longest = step.duration * step.vary.duration[1];
  if (shortest < 0.02 || longest > 30)
    fail(
      p + '.vary.duration',
      `duration support must be .02..30 seconds; received ${shortest}..${longest}; ${context}`,
    );
  const arithmeticTolerance = 8 * Number.EPSILON * Math.max(1, recipe.duration);
  if (earliest < 0 || latest + longest > recipe.duration + arithmeticTolerance)
    fail(
      p + '.vary.timing',
      `support ${earliest}..${latest + longest} exceeds 0..${recipe.duration}; ${context}`,
    );
  if (frame(latest) + frame(longest) > frame(recipe.duration))
    fail(
      p + '.duration',
      `quantized support end ${frame(latest) + frame(longest)} exceeds ${frame(recipe.duration)} frames; ${context}`,
    );
  for (const [name, control] of controls(info.voice)) {
    if (typeof control === 'number') continue;
    for (let i = 1; i < control.points.length; i++) {
      const separation =
        Math.floor(control.points[i].at * (frame(shortest) - 1) + 0.5) -
        Math.floor(control.points[i - 1].at * (frame(shortest) - 1) + 0.5);
      if (separation < 96)
        fail(
          `${info.path}.${name}.points[${i}].at`,
          `minimum knot separation 96 frames; received ${separation}; ${context}`,
        );
    }
  }
  return { earliest, latest, shortest, longest };
};

const SOURCE_PITCH_LIMITS: Readonly<
  Record<'fm' | 'vocal' | 'chirp' | 'resonator', readonly [number, number]>
> = {
  fm: [40, 3000],
  vocal: [50, 1200],
  chirp: [500, 8000],
  resonator: [40, 16000],
};

const validateStepEndpoints = (
  playback: SoundRecipe['playback'],
  info: VoiceEntry,
  span: { earliest: number; latest: number; shortest: number; longest: number },
  context: string,
): void => {
  const first = evaluate(info.voice.gain, 0);
  const last = evaluate(info.voice.gain, 1);
  if (
    first !== 0 &&
    (insideWindow(playback, span.earliest, span.latest, false) ||
      insideWindow(playback, frame(span.earliest), frame(span.latest), true))
  )
    fail(
      info.path + '.gain',
      `event onset inside playback requires zero endpoint gain; ${context}`,
    );
  const minEnd = span.earliest + span.shortest;
  const maxEnd = span.latest + span.longest;
  if (
    last !== 0 &&
    (insideWindow(playback, minEnd, maxEnd, false) ||
      insideWindow(
        playback,
        frame(span.earliest) + frame(span.shortest),
        frame(span.latest) + frame(span.longest),
        true,
      ))
  )
    fail(
      info.path + '.gain',
      `event termination inside playback requires zero endpoint gain; ${context}`,
    );
};

const validateStepGainAndPitch = (
  playback: SoundRecipe['playback'],
  info: VoiceEntry,
  step: SoundRecipe['sequences'][number]['steps'][number],
  span: { earliest: number; latest: number; shortest: number; longest: number },
  context: string,
  p: string,
): void => {
  validateStepEndpoints(playback, info, span, context);
  const { voice } = info;
  if (step.gain * step.vary.gain[1] * bounds(voice.gain)[1] > 4)
    fail(p + '.vary.gain', 'combined event gain exceeds 4');
  const s = voice.source;
  if (s.kind === 'noise') {
    if (step.pitchCents !== 0 || step.vary.pitchCents.some((v) => v !== 0))
      fail(p + '.pitchCents', 'noise requires zero pitch variation');
    return;
  }
  const lo = 2 ** ((step.pitchCents + step.vary.pitchCents[0]) / 1200);
  const hi = 2 ** ((step.pitchCents + step.vary.pitchCents[1]) / 1200);
  const frequencies =
    s.kind === 'resonator'
      ? [Math.min(...s.modes.map((m) => m.hz)), Math.max(...s.modes.map((m) => m.hz))]
      : bounds(s.pitch);
  const limits = SOURCE_PITCH_LIMITS[s.kind];
  if (frequencies[0] * lo < limits[0] || frequencies[1] * hi > limits[1])
    fail(
      p + '.vary.pitchCents',
      `shifted pitch support ${frequencies[0] * lo}..${frequencies[1] * hi} exceeds ${limits.join('..')} Hz; ${context}`,
    );
  if (
    s.kind === 'resonator' &&
    s.excitation.kind === 'noise' &&
    s.excitation.duration > span.shortest
  )
    fail(
      info.path + '.source.excitation.duration',
      `excitation exceeds shortest event ${span.shortest}; ${context}`,
    );
};

interface SupportEdge {
  at: number;
  delta: number;
  path: string;
}

const collectPlanStepSupports = (
  recipe: SoundRecipe,
  voices: Map<string, VoiceEntry>,
): { frames: number; work: number; edges: SupportEdge[] } => {
  let frames = 0;
  let work = 0;
  const edges: SupportEdge[] = [];
  for (const sequence of [...recipe.sequences].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const si = recipe.sequences.indexOf(sequence);
    for (let iteration = 0; iteration < sequence.repeat.count; iteration++) {
      for (const step of [...sequence.steps].sort((a, b) => (a.id < b.id ? -1 : 1))) {
        const p = `recipe.sequences[${si}].steps[${sequence.steps.indexOf(step)}]`;
        const info = voices.get(step.voice)!;
        const context = `sequence ${sequence.id}, step ${step.id}, iteration ${iteration}`;
        const span = validateStepTimingAndKnots(recipe, info, step, sequence, iteration, p);
        validateStepGainAndPitch(recipe.playback, info, step, span, context, p);
        const count = frame(span.longest) * recipe.variants.length;
        frames += count;
        work +=
          count *
          (weight(info.voice) +
            controls(info.voice).filter(([, c]) => typeof c !== 'number').length);
        edges.push(
          { at: frame(span.earliest), delta: 1, path: p },
          { at: frame(span.latest) + frame(span.longest), delta: -1, path: p },
        );
      }
    }
  }
  return { frames, work, edges };
};

export const validatePlan = (recipe: SoundRecipe): SoundBudget => {
  const voices = validateVoices(recipe);
  const instances = recipe.sequences.reduce((n, s) => n + s.repeat.count * s.steps.length, 0);
  if (instances > 256)
    fail('recipe.sequences', `expanded instance limit 256; received ${instances}`);
  validateLoopPlayback(recipe.playback);
  const { frames, work, edges } = collectPlanStepSupports(recipe, voices);
  if (frames > 24000000)
    fail('recipe.sequences', `event frame budget 24000000; received ${frames}`);
  if (work > 192000000)
    fail('recipe.sequences', `weighted DSP frame budget 192000000; received ${work}`);
  let active = 0;
  for (const edge of edges.sort((a, b) => a.at - b.at || a.delta - b.delta)) {
    active += edge.delta;
    if (active > 32)
      fail(
        edge.path,
        `simultaneously active instance limit 32 across variation support; received ${active}`,
      );
  }
  return Object.freeze({
    eventFrames: frames,
    weightedFrames: work,
    outputFrames: frame(recipe.duration) * recipe.variants.length,
  });
};
