import type { Range, SoundRecipe, SoundVariant, SoundVoice } from './contract';
import { frame } from './curve';
import { streams, type Domain } from './random';

export interface Event {
  readonly voice: SoundVoice;
  readonly start: number;
  readonly frames: number;
  readonly gain: number;
  readonly pitch: number;
  readonly stream: (domain: Domain) => () => number;
  readonly path: string;
}

const buildScheduledEvent = (
  recipe: SoundRecipe,
  variant: SoundVariant,
  voices: Map<string, SoundVoice>,
  sequence: SoundRecipe['sequences'][number],
  iteration: number,
  step: SoundRecipe['sequences'][number]['steps'][number],
): Event => {
  const stream = streams(recipe, variant, sequence.id, iteration, step.id, step.voice);
  const sample = (range: Range, domain: Domain) =>
    range[0] === range[1] ? range[0] : range[0] + (range[1] - range[0]) * stream(domain)();
  const vary = step.vary ?? {};
  const timing = vary.timing ?? [0, 0];
  const pitchR = vary.pitchCents ?? [0, 0];
  const gainR = vary.gain ?? [1, 1];
  const durR = vary.duration ?? [1, 1];
  const period = sequence.repeat?.period ?? 0;
  return {
    voice: voices.get(step.voice)!,
    start: frame(sequence.start + iteration * period + step.at + sample(timing, 'timing')),
    frames: frame(step.duration * sample(durR, 'duration')),
    gain: (step.gain ?? 1) * sample(gainR, 'gain'),
    pitch: 2 ** (((step.pitchCents ?? 0) + sample(pitchR, 'pitch')) / 1200),
    stream,
    path: `recipe.sequences[${recipe.sequences.indexOf(sequence)}].steps[${sequence.steps.indexOf(step)}] (sequence ${sequence.id}, step ${step.id}, iteration ${iteration})`,
  };
};

export function* schedule(recipe: SoundRecipe, variant: SoundVariant): Generator<Event> {
  const voices = new Map(recipe.voices.map((v) => [v.id, v]));
  for (const sequence of [...recipe.sequences].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const steps = [...sequence.steps].sort((a, b) => (a.id < b.id ? -1 : 1));
    const count = sequence.repeat?.count ?? 1;
    for (let iteration = 0; iteration < count; iteration++) {
      for (const step of steps)
        yield buildScheduledEvent(recipe, variant, voices, sequence, iteration, step);
    }
  }
}
