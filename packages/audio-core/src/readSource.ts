import type { Control } from './contract';
import { closed, fail, id, list, number, ordered } from './validate';
export const readControl = (value: unknown, min: number, max: number, path: string, linear = false): Control => {
  if (typeof value === 'number') return number(value, min, max, path);
  const c = closed(value, ['domain', 'interpolation', 'points'], path);
  if (c.domain !== 'linear' && (linear || c.domain !== 'log')) fail(path + '.domain', `expected ${linear ? 'linear' : 'linear or log'}`);
  if (c.interpolation !== 'linear' && c.interpolation !== 'smooth') fail(path + '.interpolation', 'expected linear or smooth');
  let previous = -1;
  const points = list(c.points, 2, 16, path + '.points');
  points.forEach((raw, i) => {
    const p = `${path}.points[${i}]`, point = closed(raw, ['at', 'value'], p);
    const at = number(point.at, 0, 1, p + '.at');
    if (at <= previous || (i === 0 && at !== 0) || (i === points.length - 1 && at !== 1)) fail(p + '.at', 'knots must strictly increase from 0 to 1');
    previous = at; number(point.value, min, max, p + '.value');
    if (c.domain === 'log' && point.value === 0) fail(p + '.value', 'log values must be positive');
  });
  return value as Control;
};
export const readSource = (value: unknown, path: string): void => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected source');
  const s = value as Record<string, unknown>;
  const n = (key: string, min: number, max: number) => number(s[key], min, max, `${path}.${key}`);
  const c = (key: string, min: number, max: number, linear = false) => readControl(s[key], min, max, `${path}.${key}`, linear);
  if (s.kind === 'noise') closed(s, ['kind'], path);
  else if (s.kind === 'fm') {
    closed(s, ['kind', 'pitch', 'ratio', 'index', 'vibratoHz', 'vibratoCents'], path);
    c('pitch', 40, 3000); c('index', 0, 4, true); n('ratio', .25, 4); n('vibratoHz', 0, 25); n('vibratoCents', 0, 100);
  } else if (s.kind === 'vocal') {
    closed(s, ['kind', 'pitch', 'formants', 'bandwidths', 'breath', 'jitter', 'roughness'], path);
    c('pitch', 50, 1200);
    for (const key of ['formants', 'bandwidths']) list(s[key], 3, 3, `${path}.${key}`).forEach((v, i) => number(v, key === 'formants' ? 150 : 40, key === 'formants' ? 7000 : 1500, `${path}.${key}[${i}]`));
    for (const key of ['breath', 'jitter', 'roughness']) n(key, 0, 1);
  } else if (s.kind === 'chirp') {
    closed(s, ['kind', 'pitch', 'trillHz', 'trillCents', 'trillDepth', 'breath', 'jitterCents', 'brightness'], path);
    c('pitch', 500, 8000); c('brightness', 0, 1, true);
    n('trillHz', 0, 100); n('trillCents', 0, 300); n('trillDepth', 0, 1); n('breath', 0, .2); n('jitterCents', 0, 80);
  } else if (s.kind === 'resonator') {
    closed(s, ['kind', 'excitation', 'modes'], path);
    const e = s.excitation as Record<string, unknown> | null;
    if (e?.kind === 'impulse') closed(e, ['kind'], path + '.excitation');
    else if (e?.kind === 'noise') { closed(e, ['kind', 'duration'], path + '.excitation'); number(e.duration, .002, .05, path + '.excitation.duration'); }
    else fail(path + '.excitation.kind', 'expected impulse or noise');
    const ids = new Set<string>(); let positive = false;
    ordered(list(s.modes, 1, 16, path + '.modes')).forEach(({ raw, index: i }) => {
      const p = `${path}.modes[${i}]`, mode = closed(raw, ['id', 'hz', 'decay', 'gain'], p);
      id(mode.id, p + '.id', ids); number(mode.hz, 40, 16000, p + '.hz'); number(mode.decay, .01, 10, p + '.decay');
      const gain = number(mode.gain, 0, 1, p + '.gain'); positive ||= gain > 0;
    });
    if (!positive) fail(path + '.modes', 'at least one mode gain must be positive');
  } else fail(path + '.kind', `unsupported source ${String(s.kind)}`);
};
