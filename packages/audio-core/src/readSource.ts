import type { Control, FilterSpec, GainControl } from './contract';
import { choice, closed, fail, id, list, number, ordered } from './validate';

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

export const readGainControl = (value: unknown, path: string): GainControl => {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'env' in value) {
    const r = value as Record<string, unknown>;
    const env = choice(r.env, ['ad', 'adsr'], `${path}.env`);
    if (env === 'ad') {
      closed(r, ['env', 'attack'], path, ['peak', 'curve']);
      number(r.attack, 0.002, 10, `${path}.attack`);
    } else {
      closed(r, ['env', 'attack', 'decay', 'sustain', 'release'], path, ['peak', 'curve']);
      number(r.attack, 0.002, 10, `${path}.attack`);
      number(r.decay, 0.002, 10, `${path}.decay`);
      number(r.sustain, 0, 1, `${path}.sustain`);
      number(r.release, 0.002, 10, `${path}.release`);
    }
    if (r.peak !== undefined) number(r.peak, 0.01, 2, `${path}.peak`);
    if (r.curve !== undefined) choice(r.curve, ['linear', 'exp'], `${path}.curve`);
    return value as GainControl;
  }
  return readControl(value, 0, 2, path, true);
};

export const readVoiceFilter = (value: unknown, path: string): FilterSpec => {
  const f = closed(value, ['kind', 'cutoff'], path, ['q']);
  const kind = choice(f.kind, ['lowpass', 'highpass', 'bandpass', 'notch'], `${path}.kind`);
  const cutoff = readControl(f.cutoff, 20, 18000, `${path}.cutoff`);
  return {
    kind,
    cutoff,
    ...(f.q !== undefined ? { q: readControl(f.q, 0.5, 12, `${path}.q`, true) } : {}),
  };
};

const readResonatorExcitation = (raw: unknown, path: string): void => {
  const e = closed(raw, ['kind'], path, ['duration', 'hardness']);
  const kind = choice(e.kind, ['impulse', 'noise', 'mallet'], `${path}.kind`);
  if (kind === 'impulse') {
    closed(e, ['kind'], path);
    return;
  }
  if (kind === 'noise') {
    closed(e, ['kind', 'duration'], path);
    number(e.duration, 0.002, 0.05, `${path}.duration`);
    return;
  }
  closed(e, ['kind', 'duration', 'hardness'], path);
  number(e.duration, 0.002, 0.03, `${path}.duration`);
  number(e.hardness, 0, 1, `${path}.hardness`);
};

const readResonatorSource = (s: Record<string, unknown>, path: string): void => {
  closed(s, ['kind', 'excitation', 'modes'], path, ['pitchDropCents', 'pitchDropSeconds']);
  readResonatorExcitation(s.excitation, path + '.excitation');
  if (s.pitchDropCents !== undefined) number(s.pitchDropCents, 0, 600, `${path}.pitchDropCents`);
  if (s.pitchDropSeconds !== undefined)
    number(s.pitchDropSeconds, 0.005, 0.2, `${path}.pitchDropSeconds`);
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
  const opt = (key: string, min: number, max: number) =>
    s[key] !== undefined ? number(s[key], min, max, `${path}.${key}`) : undefined;
  if (s.kind === 'vocal') {
    closed(s, ['kind', 'pitch', 'formants', 'bandwidths'], path, ['breath', 'jitter', 'roughness']);
    readControl(s.pitch, 50, 1200, `${path}.pitch`);
    for (const key of ['formants', 'bandwidths']) {
      const b: readonly [number, number] = key === 'formants' ? [150, 7000] : [40, 1500];
      list(s[key], 3, 3, `${path}.${key}`).forEach((v, i) =>
        number(v, b[0], b[1], `${path}.${key}[${i}]`),
      );
    }
    for (const key of ['breath', 'jitter', 'roughness']) opt(key, 0, 1);
    return;
  }
  closed(s, ['kind', 'pitch', 'brightness'], path, [
    'trillHz',
    'trillCents',
    'trillDepth',
    'breath',
    'jitterCents',
  ]);
  readControl(s.pitch, 300, 8000, `${path}.pitch`);
  readControl(s.brightness, 0, 1, `${path}.brightness`, true);
  opt('trillHz', 0, 100);
  opt('trillCents', 0, 300);
  opt('trillDepth', 0, 1);
  opt('breath', 0, 0.3);
  opt('jitterCents', 0, 80);
};

const readNoiseOrOsc = (s: Record<string, unknown>, path: string): void => {
  if (s.kind === 'noise') {
    closed(s, ['kind', 'color'], path, ['density']);
    const color = choice(s.color, ['white', 'pink', 'brown', 'crackle'], `${path}.color`);
    if (color === 'crackle') {
      if (s.density === undefined) fail(`${path}.density`, 'crackle noise requires density');
      number(s.density, 1, 500, `${path}.density`);
    } else if (s.density !== undefined) {
      fail(`${path}.density`, 'density only applies to crackle noise');
    }
    return;
  }
  closed(s, ['kind', 'waveform', 'pitch'], path, ['pulseWidth', 'unison', 'detuneCents']);
  const wave = choice(
    s.waveform,
    ['sine', 'triangle', 'saw', 'square', 'pulse'],
    `${path}.waveform`,
  );
  readControl(s.pitch, 20, 12000, `${path}.pitch`);
  if (s.pulseWidth !== undefined) {
    if (wave !== 'pulse') fail(`${path}.pulseWidth`, 'pulseWidth requires pulse waveform');
    readControl(s.pulseWidth, 0.05, 0.95, `${path}.pulseWidth`, true);
  }
  if (s.unison !== undefined) number(s.unison, 1, 4, `${path}.unison`, true);
  if (s.detuneCents !== undefined) number(s.detuneCents, 0, 50, `${path}.detuneCents`);
};

export const readSource = (value: unknown, path: string): void => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected source');
  const s = value as Record<string, unknown>;
  if (s.kind === 'noise' || s.kind === 'osc') readNoiseOrOsc(s, path);
  else if (s.kind === 'fm') {
    closed(s, ['kind', 'pitch', 'ratio', 'index'], path, ['vibratoHz', 'vibratoCents']);
    readControl(s.pitch, 40, 3000, `${path}.pitch`);
    readControl(s.index, 0, 6, `${path}.index`, true);
    number(s.ratio, 0.25, 8, `${path}.ratio`);
    if (s.vibratoHz !== undefined) number(s.vibratoHz, 0, 25, `${path}.vibratoHz`);
    if (s.vibratoCents !== undefined) number(s.vibratoCents, 0, 100, `${path}.vibratoCents`);
  } else if (s.kind === 'vocal' || s.kind === 'chirp') readVocalOrChirpSource(s, path);
  else if (s.kind === 'resonator') readResonatorSource(s, path);
  else fail(path + '.kind', `unsupported source ${String(s.kind)}`);
};
