import type { Control, SoundVoice } from './contract';
export const frame = (seconds: number): number => Math.floor(seconds * 48000 + .5);
export const evaluate = (control: Control, u: number): number => {
  if (typeof control === 'number') return control;
  const points = control.points;
  let index = 0;
  while (index < points.length - 2 && u > points[index + 1].at) index++;
  const a = points[index], b = points[index + 1];
  const v = Math.max(0, Math.min(1, (u - a.at) / (b.at - a.at)));
  const w = control.interpolation === 'smooth' ? v * v * (3 - 2 * v) : v;
  if (w === 0) return a.value;
  if (w === 1) return b.value;
  return control.domain === 'log' ? Math.exp(Math.log(a.value) * (1 - w) + Math.log(b.value) * w) : a.value * (1 - w) + b.value * w;
};
export const bounds = (control: Control): readonly [number, number] => typeof control === 'number' ? [control, control] :
  [Math.min(...control.points.map(p => p.value)), Math.max(...control.points.map(p => p.value))];
export const controls = (voice: SoundVoice): readonly (readonly [string, Control])[] => {
  const result: [string, Control][] = [['gain', voice.gain], ['highpass', voice.highpass], ['lowpass', voice.lowpass]];
  if ('pitch' in voice.source) result.push(['source.pitch', voice.source.pitch]);
  if (voice.source.kind === 'fm') result.push(['source.index', voice.source.index]);
  if (voice.source.kind === 'chirp') result.push(['source.brightness', voice.source.brightness]);
  return result;
};
