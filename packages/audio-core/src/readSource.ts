import {
  GRANULAR_TEXTURES,
  MATERIAL_PRESETS,
  type ChirpSource,
  type Control,
  type CurveEasing,
  type CurvePoint,
  type FilterSpec,
  type FmSource,
  type GainControl,
  type GranularSource,
  type MaterialSource,
  type NoiseSource,
  type OscSource,
  type SoundSource,
  type VocalSource,
  type WaveguideSource,
  type WhooshSource,
} from './contract';
import { choice, closed, fail, list, number } from './validate';

const VOWEL_TOKENS = new Set(['oo', 'ah', 'aa', 'eh', 'ee', 'ih', 'oh', 'uh', 'aw', 'er']);
const WAVEGUIDE_MODELS = ['string', 'blade', 'creak', 'pipe'] as const;

const CURVE_EASINGS: readonly CurveEasing[] = [
  'linear',
  'smooth',
  'ease_in',
  'ease_out',
  'ease_in_out',
  'snap',
];

const validateControlPoint = (
  raw: unknown,
  i: number,
  count: number,
  previous: number,
  min: number,
  max: number,
  isLog: boolean,
  path: string,
): CurvePoint => {
  const p = `${path}.points[${i}]`;
  const point = closed(raw, ['at', 'value'], p, ['easing']);
  const at = number(point.at, 0, 1, p + '.at');
  if (at <= previous || (i === 0 && at !== 0) || (i === count - 1 && at !== 1)) {
    fail(p + '.at', 'knots must strictly increase from 0 to 1');
  }
  const v = number(point.value, min, max, p + '.value');
  if (isLog && v === 0) fail(p + '.value', 'log values must be positive');
  const easing =
    point.easing !== undefined ? choice(point.easing, CURVE_EASINGS, p + '.easing') : undefined;
  return easing !== undefined ? { at, value: v, easing } : { at, value: v };
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

const readOptNum = (
  s: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  path: string,
) => (s[key] !== undefined ? number(s[key], min, max, `${path}.${key}`) : undefined);

const readVowelTrajectory = (raw: unknown, path: string): string => {
  if (typeof raw !== 'string' || raw.trim().length === 0 || raw.length > 64) {
    return fail(path, 'expected non-empty vowel trajectory string');
  }
  const tokens = raw.split(/\s*->\s*|\s+/u).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 8) {
    return fail(path, 'expected 1..8 vowel tokens');
  }
  for (const tok of tokens) {
    if (!VOWEL_TOKENS.has(tok)) {
      return fail(path, `unknown vowel "${tok}"`);
    }
  }
  return tokens.join(' -> ');
};

const readVocalFormants = (
  s: Record<string, unknown>,
  path: string,
): { readonly formants?: readonly Control[]; readonly bandwidths?: readonly number[] } => {
  const formants =
    s.formants !== undefined
      ? list(s.formants, 3, 4, `${path}.formants`).map((v, i) =>
          readControl(v, 150, 7000, `${path}.formants[${i}]`),
        )
      : undefined;
  const bandwidths =
    s.bandwidths !== undefined
      ? list(s.bandwidths, 3, 4, `${path}.bandwidths`).map((v, i) =>
          number(v, 40, 1500, `${path}.bandwidths[${i}]`),
        )
      : undefined;
  if (formants && bandwidths && bandwidths.length !== formants.length) {
    fail(`${path}.bandwidths`, `expected ${formants.length} bandwidths to match formants`);
  }
  return { formants, bandwidths };
};

const readVocalSource = (s: Record<string, unknown>, path: string): VocalSource => {
  closed(s, ['kind', 'pitch'], path, [
    'vowels',
    'formants',
    'bandwidths',
    'breath',
    'jitter',
    'roughness',
    'growl',
    'chest',
    'nasal',
    'rattle',
  ]);
  const pitch = readControl(s.pitch, 50, 1200, `${path}.pitch`);
  const vowels =
    s.vowels !== undefined ? readVowelTrajectory(s.vowels, `${path}.vowels`) : undefined;
  const { formants, bandwidths } = readVocalFormants(s, path);
  if (!vowels && !formants) fail(path, 'vocal requires vowels or formants');
  const breath = readOptNum(s, 'breath', 0, 1, path);
  const jitter = readOptNum(s, 'jitter', 0, 1, path);
  const roughness = readOptNum(s, 'roughness', 0, 1, path);
  const growl = readOptNum(s, 'growl', 0, 1, path);
  const chest = readOptNum(s, 'chest', 0, 1, path);
  const nasal = readOptNum(s, 'nasal', 0, 1, path);
  const rattle = readOptNum(s, 'rattle', 0, 1, path);
  return {
    kind: 'vocal',
    pitch,
    ...(vowels !== undefined ? { vowels } : {}),
    ...(formants !== undefined ? { formants } : {}),
    ...(bandwidths !== undefined ? { bandwidths } : {}),
    ...(breath !== undefined ? { breath } : {}),
    ...(jitter !== undefined ? { jitter } : {}),
    ...(roughness !== undefined ? { roughness } : {}),
    ...(growl !== undefined ? { growl } : {}),
    ...(chest !== undefined ? { chest } : {}),
    ...(nasal !== undefined ? { nasal } : {}),
    ...(rattle !== undefined ? { rattle } : {}),
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
    'twinBeat',
    'splash',
    'stereoSpread',
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
  const twinBeat = readOptNum(s, 'twinBeat', 0, 1, path);
  const splash = readOptNum(s, 'splash', 0, 1, path);
  const stereoSpread = readOptNum(s, 'stereoSpread', 0, 1, path);
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
    ...(twinBeat !== undefined ? { twinBeat } : {}),
    ...(splash !== undefined ? { splash } : {}),
    ...(stereoSpread !== undefined ? { stereoSpread } : {}),
  };
};

const readGranularSource = (s: Record<string, unknown>, path: string): GranularSource => {
  closed(s, ['kind', 'texture', 'density'], path, [
    'grainMs',
    'pitch',
    'spread',
    'burstiness',
    'turbulence',
    'stereoWidth',
    'itdMs',
  ]);
  const texture = choice(s.texture, GRANULAR_TEXTURES, `${path}.texture`);
  const density = readControl(s.density, 1, 500, `${path}.density`, true);
  const grainMs = readOptNum(s, 'grainMs', 3, 150, path);
  const pitch =
    s.pitch !== undefined ? readControl(s.pitch, 60, 12000, `${path}.pitch`) : undefined;
  const spread = readOptNum(s, 'spread', 0, 1, path);
  const burstiness = readOptNum(s, 'burstiness', 0, 1, path);
  const turbulence = readOptNum(s, 'turbulence', 0, 1, path);
  const stereoWidth = readOptNum(s, 'stereoWidth', 0, 1, path);
  const itdMs = readOptNum(s, 'itdMs', 0, 0.6, path);
  return {
    kind: 'granular',
    texture,
    density,
    ...(grainMs !== undefined ? { grainMs } : {}),
    ...(pitch !== undefined ? { pitch } : {}),
    ...(spread !== undefined ? { spread } : {}),
    ...(burstiness !== undefined ? { burstiness } : {}),
    ...(turbulence !== undefined ? { turbulence } : {}),
    ...(stereoWidth !== undefined ? { stereoWidth } : {}),
    ...(itdMs !== undefined ? { itdMs } : {}),
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

const readWhooshSource = (s: Record<string, unknown>, path: string): WhooshSource => {
  closed(s, ['kind', 'velocity'], path, ['thickness', 'doppler', 'sweepPan', 'noiseTone']);
  const velocity = readControl(s.velocity, 0, 4, `${path}.velocity`, true);
  const thickness = readOptNum(s, 'thickness', 0.005, 2, path);
  const doppler = readOptNum(s, 'doppler', 0, 1, path);
  const sweepPan =
    s.sweepPan !== undefined ? readControl(s.sweepPan, -1, 1, `${path}.sweepPan`, true) : undefined;
  const noiseTone = readOptNum(s, 'noiseTone', 0, 1, path);
  return {
    kind: 'whoosh',
    velocity,
    ...(thickness !== undefined ? { thickness } : {}),
    ...(doppler !== undefined ? { doppler } : {}),
    ...(sweepPan !== undefined ? { sweepPan } : {}),
    ...(noiseTone !== undefined ? { noiseTone } : {}),
  };
};

const readWaveguideSource = (s: Record<string, unknown>, path: string): WaveguideSource => {
  closed(s, ['kind', 'model', 'pitch'], path, [
    'damping',
    'stiffness',
    'bowPressure',
    'brightness',
  ]);
  const model = choice(s.model, WAVEGUIDE_MODELS, `${path}.model`);
  const pitch = readControl(s.pitch, 20, 8000, `${path}.pitch`);
  const damping = readOptNum(s, 'damping', 0, 1, path);
  const stiffness = readOptNum(s, 'stiffness', 0, 1, path);
  const bowPressure = readOptNum(s, 'bowPressure', 0, 1, path);
  const brightness = readOptNum(s, 'brightness', 0, 1, path);
  return {
    kind: 'waveguide',
    model,
    pitch,
    ...(damping !== undefined ? { damping } : {}),
    ...(stiffness !== undefined ? { stiffness } : {}),
    ...(bowPressure !== undefined ? { bowPressure } : {}),
    ...(brightness !== undefined ? { brightness } : {}),
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
  material: readMaterialSource,
  granular: readGranularSource,
  whoosh: readWhooshSource,
  waveguide: readWaveguideSource,
};

export const readSource = (value: unknown, path: string): SoundSource => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected source');
  const s = value as Record<string, unknown>;
  const reader = typeof s.kind === 'string' ? SOURCE_READERS[s.kind] : undefined;
  if (!reader) return fail(path + '.kind', `unsupported source ${String(s.kind)}`);
  return reader(s, path);
};
