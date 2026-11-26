import { compareText } from '@ashfox/internal-contracts';
import type { SoundRecipe, SoundVoice } from './contract';
import { bounds, controls, evaluate, frame } from './curve';
import { gainBounds, isEnvelopeControl } from './envelope';
import { fail } from './validate';

const weight = (voice: SoundVoice): number => {
  const s = voice.source;
  if (s.kind === 'resonator') return 4 + 4 * s.modes.length;
  if (s.kind === 'material') return 4 + 4 * (s.modes ?? 24);
  if (s.kind === 'granular') return 24;
  if (s.kind === 'osc') return 2 * (s.unison ?? 1);
  if (s.kind === 'noise') return 2;
  return { fm: 128, chirp: 8, vocal: 16 }[s.kind];
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
    compareText(a.voice.id, b.voice.id),
  )) {
    if (
      voice.highpass !== undefined &&
      voice.lowpass !== undefined &&
      bounds(voice.highpass)[1] >= bounds(voice.lowpass)[0]
    ) {
      fail(
        path + '.highpass',
        'maximum highpass must be below minimum lowpass; separate the entire cutoff ranges',
      );
    }
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

const validateEnvelopeSupport = (info: VoiceEntry, shortest: number, context: string): void => {
  const g = info.voice.gain;
  if (!isEnvelopeControl(g)) return;
  const sum = g.env === 'ad' ? g.attack : g.attack + g.decay + g.release;
  if (sum > shortest) {
    fail(
      `${info.path}.gain`,
      `envelope segment sum ${sum}s exceeds shortest duration ${shortest}s; ${context}`,
    );
  }
};

const validateKnotResolution = (info: VoiceEntry, shortest: number, context: string): void => {
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
  const vary = step.vary ?? {};
  const timing = vary.timing ?? [0, 0];
  const dur = vary.duration ?? [1, 1];
  const nominal = sequence.start + iteration * (sequence.repeat?.period ?? 0) + step.at;
  const earliest = nominal + timing[0];
  const latest = nominal + timing[1];
  const shortest = step.duration * dur[0];
  const longest = step.duration * dur[1];
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
  validateEnvelopeSupport(info, shortest, context);
  validateKnotResolution(info, shortest, context);
  return { earliest, latest, shortest, longest };
};

const SOURCE_PITCH_LIMITS: Readonly<
  Record<
    'osc' | 'fm' | 'vocal' | 'chirp' | 'resonator' | 'material' | 'granular',
    readonly [number, number]
  >
> = {
  osc: [20, 12000],
  fm: [40, 3000],
  vocal: [50, 1200],
  chirp: [300, 8000],
  resonator: [40, 16000],
  material: [20, 4000],
  granular: [60, 12000],
};

const validateStepEndpoints = (
  playback: SoundRecipe['playback'],
  info: VoiceEntry,
  span: { earliest: number; latest: number; shortest: number; longest: number },
  context: string,
): void => {
  if (isEnvelopeControl(info.voice.gain)) return;
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

const sourcePitchRange = (
  s: SoundVoice['source'],
  p: string,
  stepPitch: number,
  pitchRange: readonly [number, number],
): readonly [number, number] | null => {
  if (s.kind === 'noise' || (s.kind === 'granular' && s.pitch === undefined)) {
    if (stepPitch !== 0 || pitchRange.some((v) => v !== 0)) {
      fail(
        p + '.pitchCents',
        s.kind === 'noise'
          ? 'noise requires zero pitch variation'
          : 'granular without pitch requires zero pitch variation',
      );
    }
    return null;
  }
  if (s.kind === 'resonator') {
    return [Math.min(...s.modes.map((m) => m.hz)), Math.max(...s.modes.map((m) => m.hz))];
  }
  return bounds(s.kind === 'granular' ? s.pitch! : s.pitch);
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
  const vary = step.vary ?? {};
  const gainRange = vary.gain ?? [1, 1];
  const pitchRange = vary.pitchCents ?? [0, 0];
  const stepGain = step.gain ?? 1;
  const stepPitch = step.pitchCents ?? 0;
  if (stepGain * gainRange[1] * gainBounds(voice.gain)[1] > 4)
    fail(p + '.vary.gain', 'combined event gain exceeds 4');
  const s = voice.source;
  const frequencies = sourcePitchRange(s, p, stepPitch, pitchRange);
  if (!frequencies || s.kind === 'noise') return;
  const lo = 2 ** ((stepPitch + pitchRange[0]) / 1200);
  const hi = 2 ** ((stepPitch + pitchRange[1]) / 1200);
  const limits = SOURCE_PITCH_LIMITS[s.kind];
  if (frequencies[0] * lo < limits[0] || frequencies[1] * hi > limits[1])
    fail(
      p + '.vary.pitchCents',
      `shifted pitch support ${frequencies[0] * lo}..${frequencies[1] * hi} exceeds ${limits.join('..')} Hz; ${context}`,
    );
  if (
    s.kind === 'resonator' &&
    s.excitation.kind !== 'impulse' &&
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

const buildDynamicControlCounts = (voices: Map<string, VoiceEntry>): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const [voiceId, { voice }] of voices) {
    let dynamic = 0;
    for (const [, c] of controls(voice)) if (typeof c !== 'number') dynamic++;
    counts.set(voiceId, dynamic);
  }
  return counts;
};

const collectPlanStepSupports = (
  recipe: SoundRecipe,
  voices: Map<string, VoiceEntry>,
): { frames: number; work: number; edges: SupportEdge[] } => {
  let frames = 0;
  let work = 0;
  const edges: SupportEdge[] = [];
  const dynamicControlCounts = buildDynamicControlCounts(voices);
  const sortedSequences = recipe.sequences
    .map((sequence, index) => ({ sequence, index }))
    .sort((a, b) => compareText(a.sequence.id, b.sequence.id));
  for (const { sequence, index: si } of sortedSequences) {
    const sortedSteps = sequence.steps
      .map((step, index) => ({ step, index }))
      .sort((a, b) => compareText(a.step.id, b.step.id));
    const countRep = sequence.repeat?.count ?? 1;
    for (let iteration = 0; iteration < countRep; iteration++) {
      for (const { step, index: stepIndex } of sortedSteps) {
        const p = `recipe.sequences[${si}].steps[${stepIndex}]`;
        const info = voices.get(step.voice)!;
        const context = `sequence ${sequence.id}, step ${step.id}, iteration ${iteration}`;
        const span = validateStepTimingAndKnots(recipe, info, step, sequence, iteration, p);
        validateStepGainAndPitch(recipe.playback, info, step, span, context, p);
        const count = frame(span.longest) * recipe.variants.length;
        frames += count;
        work += count * (weight(info.voice) + dynamicControlCounts.get(step.voice)!);
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
  const instances = recipe.sequences.reduce(
    (n, s) => n + (s.repeat?.count ?? 1) * s.steps.length,
    0,
  );
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
