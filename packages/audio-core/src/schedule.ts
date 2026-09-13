import type { Range, SoundRecipe, SoundVariant, SoundVoice } from './contract';
import { frame } from './curve';
import { streams, type Domain } from './random';
export interface Event {
  readonly voice: SoundVoice; readonly start: number; readonly frames: number;
  readonly gain: number; readonly pitch: number; readonly stream: (domain: Domain) => () => number;
  readonly path: string;
}
export function* schedule(recipe: SoundRecipe, variant: SoundVariant): Generator<Event> {
  const voices = new Map(recipe.voices.map(v => [v.id, v]));
  for (const sequence of [...recipe.sequences].sort((a, b) => a.id < b.id ? -1 : 1)) {
    for (let iteration = 0; iteration < sequence.repeat.count; iteration++) {
      for (const step of [...sequence.steps].sort((a, b) => a.id < b.id ? -1 : 1)) {
        const stream = streams(recipe, variant, sequence.id, iteration, step.id, step.voice);
        const sample = (range: Range, domain: Domain) => range[0] === range[1] ? range[0] : range[0] + (range[1] - range[0]) * stream(domain)();
        yield { voice: voices.get(step.voice)!,
          start: frame(sequence.start + iteration * sequence.repeat.period + step.at + sample(step.vary.timing, 'timing')),
          frames: frame(step.duration * sample(step.vary.duration, 'duration')),
          gain: step.gain * sample(step.vary.gain, 'gain'), pitch: 2 ** ((step.pitchCents + sample(step.vary.pitchCents, 'pitch')) / 1200), stream,
          path: `recipe.sequences[${recipe.sequences.indexOf(sequence)}].steps[${sequence.steps.indexOf(step)}] (sequence ${sequence.id}, step ${step.id}, iteration ${iteration})` };
      }
    }
  }
}
