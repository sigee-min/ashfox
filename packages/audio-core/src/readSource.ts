import {
  GRANULAR_TEXTURES,
  MATERIAL_PRESETS,
  type ChirpSource,
  type Control,
  type FilterSpec,
  type FmSource,
  type GainControl,
  type GranularSource,
  type MaterialSource,
  type NoiseSource,
  type OscSource,
  type ResonatorSource,
  type SoundSource,
  type VocalSource,
} from './contract';
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
): { readonly at: number; readonly value: number } => {
  const p = `${path}.points[${i}]`;
  const point = closed(raw, ['at', 'value'], p);
  const at = number(point.at, 0, 1, p + '.at');
  if (at <= previous || (i === 0 && at !== 0) || (i === count - 1 && at !== 1))
    fail(p + '.at', 'knots must strictly increase from 0 to 1');
  const v = number(point.value, min, max, p + '.value');
  if (isLog && v === 0) fail(p + '.value', 'log values must be positive');
  return { at, value: v };
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
  const domain = choice(c.domain, linear ? ['linear'] : ['linear', 'log'], path + '.domain');
  const interpolation = choice(c.interpolation, ['linear', 'smooth'], path + '.interpolation');
  let previous = -1;
  const rawPoints = list(c.points, 2, 16, path + '.points');
  const points = rawPoints.map((raw, i) => {
    const point = validateControlPoint(
      raw,
      i,
      rawPoints.length,
      previous,
      min,
      max,
      domain === 'log',
      path,
    );
    previous = point.at;
    return point;
  });
  return { domain, interpolation, points };
};

export const readGainControl = (value: unknown, path: string): GainControl => {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'env' in value) {
    const r = value as Record<string, unknown>;
    const env = choice(r.env, ['ad', 'adsr'], `${path}.env`);
    const required =
      env === 'ad'
        ? (['env', 'attack'] as const)
        : (['env', 'attack', 'decay', 'sustain', 'release'] as const);
    closed(r, required, path, ['peak', 'curve']);
    const attack = number(r.attack, 0.002, 10, `${path}.attack`);
    const peak = r.peak !== undefined ? number(r.peak, 0.01, 2, `${path}.peak`) : undefined;
    const curve =
      r.curve !== undefined ? choice(r.curve, ['linear', 'exp'], `${path}.curve`) : undefined;
    const extras = {
      ...(peak !== undefined ? { peak } : {}),
      ...(curve !== undefined ? { curve } : {}),
    };
    if (env === 'ad') return { env: 'ad', attack, ...extras };
    return {
      env: 'adsr',
      attack,
      decay: number(r.decay, 0.002, 10, `${path}.decay`),
      sustain: number(r.sustain, 0, 1, `${path}.sustain`),
      release: number(r.release, 0.002, 10, `${path}.release`),
      ...extras,
    };
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

const readResonatorExcitation = (raw: unknown, path: string): ResonatorSource['excitation'] => {
  const e = closed(raw, ['kind'], path, ['duration', 'hardness']);
  const kind = choice(e.kind, ['impulse', 'noise', 'mallet'], `${path}.kind`);
  if (kind === 'impulse') {
    closed(e, ['kind'], path);
    return { kind: 'impulse' };
  }
  if (kind === 'noise') {
    closed(e, ['kind', 'duration'], path);
    return { kind: 'noise', duration: number(e.duration, 0.002, 0.05, `${path}.duration`) };
  }
  closed(e, ['kind', 'duration', 'hardness'], path);
  return {
    kind: 'mallet',
    duration: number(e.duration, 0.002, 0.03, `${path}.duration`),
    hardness: number(e.hardness, 0, 1, `${path}.hardness`),
  };
};

const readResonatorSource = (s: Record<string, unknown>, path: string): ResonatorSource => {
  closed(s, ['kind', 'excitation', 'modes'], path, ['pitchDropCents', 'pitchDropSeconds']);
  const excitation = readResonatorExcitation(s.excitation, path + '.excitation');
  const pitchDropCents =
    s.pitchDropCents !== undefined
      ? number(s.pitchDropCents, 0, 600, `${path}.pitchDropCents`)
      : undefined;
  const pitchDropSeconds =
    s.pitchDropSeconds !== undefined
      ? number(s.pitchDropSeconds, 0.005, 0.2, `${path}.pitchDropSeconds`)
      : undefined;
  const ids = new Set<string>();
  let positive = false;
  const rawModes = list(s.modes, 1, 16, path + '.modes');
  const modes = new Array<ResonatorSource['modes'][number]>(rawModes.length);
  ordered(rawModes).forEach(({ raw, index: i }) => {
    const p = `${path}.modes[${i}]`;
    const mode = closed(raw, ['id', 'hz', 'decay', 'gain'], p);
    const modeId = id(mode.id, p + '.id', ids);
    const hz = number(mode.hz, 40, 16000, p + '.hz');
    const decay = number(mode.decay, 0.01, 10, p + '.decay');
    const gain = number(mode.gain, 0, 1, p + '.gain');
    if (gain > 0) positive = true;
    modes[i] = { id: modeId, hz, decay, gain };
  });
  if (!positive) fail(path + '.modes', 'at least one mode gain must be positive');
  return {
    kind: 'resonator',
    excitation,
    modes,
    ...(pitchDropCents !== undefined ? { pitchDropCents } : {}),
    ...(pitchDropSeconds !== undefined ? { pitchDropSeconds } : {}),
  };
};

const readOptNum = (
  s: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  path: string,
) => (s[key] !== undefined ? number(s[key], min, max, `${path}.${key}`) : undefined);

const readVocalSource = (s: Record<string, unknown>, path: string): VocalSource => {
  closed(s, ['kind', 'pitch', 'formants', 'bandwidths'], path, [
    'breath',
    'jitter',
    'roughness',
    'growl',
    'chest',
    'nasal',
  ]);
  const pitch = readControl(s.pitch, 50, 1200, `${path}.pitch`);
  const formants = list(s.formants, 3, 4, `${path}.formants`).map((v, i) =>
    readControl(v, 150, 7000, `${path}.formants[${i}]`),
  );
  const bandwidths = list(s.bandwidths, 3, 4, `${path}.bandwidths`).map((v, i) =>
    number(v, 40, 1500, `${path}.bandwidths[${i}]`),
  );
  if (bandwidths.length !== formants.length) {
    fail(`${path}.bandwidths`, `expected ${formants.length} bandwidths to match formants`);
  }
  const breath = readOptNum(s, 'breath', 0, 1, path);
  const jitter = readOptNum(s, 'jitter', 0, 1, path);
  const roughness = readOptNum(s, 'roughness', 0, 1, path);
  const growl = readOptNum(s, 'growl', 0, 1, path);
  const chest = readOptNum(s, 'chest', 0, 1, path);
  const nasal = readOptNum(s, 'nasal', 0, 1, path);
  return {
    kind: 'vocal',
    pitch,
    formants,
    bandwidths,
    ...(breath !== undefined ? { breath } : {}),
    ...(jitter !== undefined ? { jitter } : {}),
    ...(roughness !== undefined ? { roughness } : {}),
    ...(growl !== undefined ? { growl } : {}),
    ...(chest !== undefined ? { chest } : {}),
    ...(nasal !== undefined ? { nasal } : {}),
  };
};

const readChirpSource = (s: Record<string, unknown>, path: string): ChirpSource => {
  closed(s, ['kind', 'pitch', 'brightness'], path, [
    'trillHz',
    'trillCents',
    'trillDepth',
    'breath',
    'jitterCents',
  ]);
  const pitch = readControl(s.pitch, 300, 8000, `${path}.pitch`);
  const brightness = readControl(s.brightness, 0, 1, `${path}.brightness`, true);
  const trillHz = readOptNum(s, 'trillHz', 0, 100, path);
  const trillCents = readOptNum(s, 'trillCents', 0, 300, path);
  const trillDepth = readOptNum(s, 'trillDepth', 0, 1, path);
  const breath = readOptNum(s, 'breath', 0, 0.3, path);
  const jitterCents = readOptNum(s, 'jitterCents', 0, 80, path);
  return {
    kind: 'chirp',
    pitch,
    brightness,
    ...(trillHz !== undefined ? { trillHz } : {}),
    ...(trillCents !== undefined ? { trillCents } : {}),
    ...(trillDepth !== undefined ? { trillDepth } : {}),
    ...(breath !== undefined ? { breath } : {}),
    ...(jitterCents !== undefined ? { jitterCents } : {}),
  };
};

const readNoiseSource = (s: Record<string, unknown>, path: string): NoiseSource => {
  closed(s, ['kind', 'color'], path);
  const color = choice(s.color, ['white', 'pink', 'brown'], `${path}.color`);
  return { kind: 'noise', color };
};

const readMaterialSource = (s: Record<string, unknown>, path: string): MaterialSource => {
  closed(s, ['kind', 'material', 'pitch'], path, [
    'size',
    'hardness',
    'damping',
    'brightness',
    'modes',
    'strike',
    'bounces',
  ]);
  const material = choice(s.material, MATERIAL_PRESETS, `${path}.material`);
  const pitch = readControl(s.pitch, 20, 4000, `${path}.pitch`);
  const size = readOptNum(s, 'size', 0.25, 4, path);
  const hardness = readOptNum(s, 'hardness', 0, 1, path);
  const damping = readOptNum(s, 'damping', 0, 1, path);
  const brightness = readOptNum(s, 'brightness', 0, 1, path);
  const modes = s.modes !== undefined ? number(s.modes, 4, 32, `${path}.modes`, true) : undefined;
  const strike =
    s.strike !== undefined
      ? choice(s.strike, ['mallet', 'scrape', 'bounce'], `${path}.strike`)
      : undefined;
  const bounces =
    s.bounces !== undefined ? number(s.bounces, 1, 6, `${path}.bounces`, true) : undefined;
  if (bounces !== undefined && strike !== 'bounce') {
    fail(`${path}.bounces`, 'bounces requires strike = bounce');
  }
  return {
    kind: 'material',
    material,
    pitch,
    ...(size !== undefined ? { size } : {}),
    ...(hardness !== undefined ? { hardness } : {}),
    ...(damping !== undefined ? { damping } : {}),
    ...(brightness !== undefined ? { brightness } : {}),
    ...(modes !== undefined ? { modes } : {}),
    ...(strike !== undefined ? { strike } : {}),
    ...(bounces !== undefined ? { bounces } : {}),
  };
};

const readGranularSource = (s: Record<string, unknown>, path: string): GranularSource => {
  closed(s, ['kind', 'texture', 'density'], path, [
    'grainMs',
    'pitch',
    'spread',
    'burstiness',
    'turbulence',
  ]);
  const texture = choice(s.texture, GRANULAR_TEXTURES, `${path}.texture`);
  const density = readControl(s.density, 1, 500, `${path}.density`, true);
  const grainMs = readOptNum(s, 'grainMs', 3, 150, path);
  const pitch =
    s.pitch !== undefined ? readControl(s.pitch, 60, 12000, `${path}.pitch`) : undefined;
  const spread = readOptNum(s, 'spread', 0, 1, path);
  const burstiness = readOptNum(s, 'burstiness', 0, 1, path);
  const turbulence = readOptNum(s, 'turbulence', 0, 1, path);
  return {
    kind: 'granular',
    texture,
    density,
    ...(grainMs !== undefined ? { grainMs } : {}),
    ...(pitch !== undefined ? { pitch } : {}),
    ...(spread !== undefined ? { spread } : {}),
    ...(burstiness !== undefined ? { burstiness } : {}),
    ...(turbulence !== undefined ? { turbulence } : {}),
  };
};

const readOscSource = (s: Record<string, unknown>, path: string): OscSource => {
  closed(s, ['kind', 'waveform', 'pitch'], path, ['pulseWidth', 'unison', 'detuneCents']);
  const waveform = choice(
    s.waveform,
    ['sine', 'triangle', 'saw', 'square', 'pulse'],
    `${path}.waveform`,
  );
  const pitch = readControl(s.pitch, 20, 12000, `${path}.pitch`);
  let pulseWidth: Control | undefined;
  if (s.pulseWidth !== undefined) {
    if (waveform !== 'pulse') fail(`${path}.pulseWidth`, 'pulseWidth requires pulse waveform');
    pulseWidth = readControl(s.pulseWidth, 0.05, 0.95, `${path}.pulseWidth`, true);
  }
  const unison =
    s.unison !== undefined ? number(s.unison, 1, 4, `${path}.unison`, true) : undefined;
  const detuneCents = readOptNum(s, 'detuneCents', 0, 50, path);
  return {
    kind: 'osc',
    waveform,
    pitch,
    ...(pulseWidth !== undefined ? { pulseWidth } : {}),
    ...(unison !== undefined ? { unison } : {}),
    ...(detuneCents !== undefined ? { detuneCents } : {}),
  };
};

const readFmSource = (s: Record<string, unknown>, path: string): FmSource => {
  closed(s, ['kind', 'pitch', 'ratio', 'index'], path, ['vibratoHz', 'vibratoCents']);
  const pitch = readControl(s.pitch, 40, 3000, `${path}.pitch`);
  const index = readControl(s.index, 0, 6, `${path}.index`, true);
  const ratio = number(s.ratio, 0.25, 8, `${path}.ratio`);
  const vibratoHz = readOptNum(s, 'vibratoHz', 0, 25, path);
  const vibratoCents = readOptNum(s, 'vibratoCents', 0, 100, path);
  return {
    kind: 'fm',
    pitch,
    ratio,
    index,
    ...(vibratoHz !== undefined ? { vibratoHz } : {}),
    ...(vibratoCents !== undefined ? { vibratoCents } : {}),
  };
};

const SOURCE_READERS: Readonly<
  Record<string, (s: Record<string, unknown>, path: string) => SoundSource>
> = {
  noise: readNoiseSource,
  osc: readOscSource,
  fm: readFmSource,
  vocal: readVocalSource,
  chirp: readChirpSource,
  resonator: readResonatorSource,
  material: readMaterialSource,
  granular: readGranularSource,
};

export const readSource = (value: unknown, path: string): SoundSource => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected source');
  const s = value as Record<string, unknown>;
  const reader = typeof s.kind === 'string' ? SOURCE_READERS[s.kind] : undefined;
  if (!reader) return fail(path + '.kind', `unsupported source ${String(s.kind)}`);
  return reader(s, path);
};
