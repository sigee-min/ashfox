import type { SoundRecipe, Control } from '../../src';
export const envelope = (peak = 1): Control => ({ domain: 'linear', interpolation: 'smooth', points: [
  { at: 0, value: 0 }, { at: .1, value: peak }, { at: .9, value: peak }, { at: 1, value: 0 }
] });
export const fixture = (): SoundRecipe => ({ id: 'test', duration: 1, sampleRate: 48000, seed: 123,
  voices: [{ id: 'tone', source: { kind: 'fm', pitch: 440, ratio: 1, index: 0, vibratoHz: 0, vibratoCents: 0 }, gain: envelope(), highpass: 10, lowpass: 16000 }],
  sequences: [{ id: 'phrase', start: 0, repeat: { count: 1, period: 0 }, steps: [{ id: 'note', voice: 'tone', at: 0, duration: 1, gain: 1, pitchCents: 0,
    vary: { timing: [0, 0], pitchCents: [0, 0], gain: [1, 1], duration: [1, 1] } }] }],
  variants: [{ id: 'base', seed: 42 }, { id: 'alternate', seed: 43 }], playback: { kind: 'oneshot' }, output: { gainDb: -12, peakDb: -3 } });
export const literal = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(literal).join(', ')}]`;
  if (value && typeof value === 'object') return `{\n${Object.entries(value).map(([k, v]) => `${k} = ${literal(v)};`).join('\n')}\n}`;
  return JSON.stringify(value);
};
export const native = (recipe: SoundRecipe): string => {
  const { id, ...body } = recipe; return `ashfox-model 1\nsound ${id} ${literal(body)}`;
};
