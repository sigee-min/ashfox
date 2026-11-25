import type { Control } from './contract';
import { closed, fail, id, list, number, ordered } from './validate';
const validateControlPoint = (
  raw: unknown,
  i: number,
  count: number,
  previous: number,
  min: number,
  max: number,
  isLog: boolean,
  path: string,
): number => {
  const p = `${path}.points[${i}]`;
  const point = closed(raw, ['at', 'value'], p);
  const at = number(point.at, 0, 1, p + '.at');
  if (at <= previous || (i === 0 && at !== 0) || (i === count - 1 && at !== 1))
    fail(p + '.at', 'knots must strictly increase from 0 to 1');
  const v = number(point.value, min, max, p + '.value');
  if (isLog && v === 0) fail(p + '.value', 'log values must be positive');
  return at;
};

export const readControl = (
  value: unknown,
  min: number,
  max: number,
  path: string,
  linear = false,
): Control => {
  if (typeof value === 'number') return number(value, min, max, path);
  const c = closed(value, ['domain', 'interpolation', 'points'], path);
  if (c.domain !== 'linear' && (linear || c.domain !== 'log'))
    fail(path + '.domain', `expected ${linear ? 'linear' : 'linear or log'}`);
  if (c.interpolation !== 'linear' && c.interpolation !== 'smooth')
    fail(path + '.interpolation', 'expected linear or smooth');
  let previous = -1;
  const points = list(c.points, 2, 16, path + '.points');
  points.forEach((raw, i) => {
    previous = validateControlPoint(
      raw,
      i,
      points.length,
      previous,
      min,
      max,
      c.domain === 'log',
      path,
    );
  });
  return value as Control;
};

const readResonatorSource = (s: Record<string, unknown>, path: string): void => {
  closed(s, ['kind', 'excitation', 'modes'], path);
  const e = s.excitation as Record<string, unknown> | null;
  if (e?.kind === 'impulse') closed(e, ['kind'], path + '.excitation');
  else if (e?.kind === 'noise') {
    closed(e, ['kind', 'duration'], path + '.excitation');
    number(e.duration, 0.002, 0.05, path + '.excitation.duration');
  } else fail(path + '.excitation.kind', 'expected impulse or noise');
  const ids = new Set<string>();
  let positive = false;
  ordered(list(s.modes, 1, 16, path + '.modes')).forEach(({ raw, index: i }) => {
    const p = `${path}.modes[${i}]`;
    const mode = closed(raw, ['id', 'hz', 'decay', 'gain'], p);
    id(mode.id, p + '.id', ids);
    number(mode.hz, 40, 16000, p + '.hz');
    number(mode.decay, 0.01, 10, p + '.decay');
    if (number(mode.gain, 0, 1, p + '.gain') > 0) positive = true;
  });
  if (!positive) fail(path + '.modes', 'at least one mode gain must be positive');
};

const readVocalOrChirpSource = (s: Record<string, unknown>, path: string): void => {
  const n = (key: string, min: number, max: number) => number(s[key], min, max, `${path}.${key}`);
  const c = (key: string, min: number, max: number, linear = false) =>
    readControl(s[key], min, max, `${path}.${key}`, linear);
  if (s.kind === 'vocal') {
    closed(s, ['kind', 'pitch', 'formants', 'bandwidths', 'breath', 'jitter', 'roughness'], path);
    c('pitch', 50, 1200);
    for (const key of ['formants', 'bandwidths']) {
      const bounds: readonly [number, number] = key === 'formants' ? [150, 7000] : [40, 1500];
      list(s[key], 3, 3, `${path}.${key}`).forEach((v, i) =>
        number(v, bounds[0], bounds[1], `${path}.${key}[${i}]`),
      );
    }
    for (const key of ['breath', 'jitter', 'roughness']) n(key, 0, 1);
    return;
  }
  closed(
    s,
    ['kind', 'pitch', 'trillHz', 'trillCents', 'trillDepth', 'breath', 'jitterCents', 'brightness'],
    path,
  );
  c('pitch', 500, 8000);
  c('brightness', 0, 1, true);
  n('trillHz', 0, 100);
  n('trillCents', 0, 300);
  n('trillDepth', 0, 1);
  n('breath', 0, 0.2);
  n('jitterCents', 0, 80);
};

export const readSource = (value: unknown, path: string): void => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected source');
  const s = value as Record<string, unknown>;
  if (s.kind === 'noise') closed(s, ['kind'], path);
  else if (s.kind === 'fm') {
    closed(s, ['kind', 'pitch', 'ratio', 'index', 'vibratoHz', 'vibratoCents'], path);
    readControl(s.pitch, 40, 3000, `${path}.pitch`);
    readControl(s.index, 0, 4, `${path}.index`, true);
    number(s.ratio, 0.25, 4, `${path}.ratio`);
    number(s.vibratoHz, 0, 25, `${path}.vibratoHz`);
    number(s.vibratoCents, 0, 100, `${path}.vibratoCents`);
  } else if (s.kind === 'vocal' || s.kind === 'chirp') readVocalOrChirpSource(s, path);
  else if (s.kind === 'resonator') readResonatorSource(s, path);
  else fail(path + '.kind', `unsupported source ${String(s.kind)}`);
};
