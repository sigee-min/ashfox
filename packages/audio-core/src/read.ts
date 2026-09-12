import type { SoundRecipe } from './contract';
type RecordValue = Record<string, unknown>;

const fail = (path: string, message: string): never => { throw new Error(`${path}: ${message}`); };
const closed = (value: unknown, keys: readonly string[], path: string): RecordValue => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(path, 'expected record');
  const record = value as RecordValue;
  for (const key of Object.keys(record)) if (!keys.includes(key)) fail(`${path}.${key}`, 'unknown field');
  for (const key of keys) if (!Object.prototype.hasOwnProperty.call(record, key)) fail(`${path}.${key}`, 'missing field');
  return record;
};
const range = (value: unknown, min: number, max: number, path: string) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(path, `expected ${min}..${max}`);
};
const pair = (value: unknown, min: number, max: number, path: string) => {
  if (!Array.isArray(value) || value.length !== 2) fail(path, 'expected two values');
  (value as unknown[]).forEach((v, i) => range(v, min, max, `${path}[${i}]`));
};
const freeze = (value: unknown): unknown => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

// Closed code-authored sound definition. Separate from the model workspace grammar.
export const readRecipe = (input: unknown): SoundRecipe => {
  const path = 'recipe';
  const root = closed(input, ['format', 'version', 'id', 'duration', 'sampleRate', 'seed', 'variants', 'output', 'layers'], path);
  if (root.format !== 'ashfox-sound' || root.version !== 1) fail(path, 'unsupported recipe format');
  if (typeof root.id !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/u.test(root.id)) fail(`${path}.id`, 'invalid identifier');
  range(root.duration, 0.05, 5, `${path}.duration`);
  if (root.sampleRate !== 48000) fail(`${path}.sampleRate`, 'only 48000 Hz is supported');
  range(root.seed, 1, 0xffffffff, `${path}.seed`);
  if (!Number.isInteger(root.seed)) fail(`${path}.seed`, 'expected integer');
  if (!Array.isArray(root.layers) || root.layers.length < 1 || root.layers.length > 8) fail(`${path}.layers`, 'expected 1..8 layers');
  const output = closed(root.output, ['rmsDb', 'peakDb'], 'recipe.output');
  range(output.rmsDb, -48, -6, 'recipe.output.rmsDb');
  range(output.peakDb, -12, -1, 'recipe.output.peakDb');
  if (!Array.isArray(root.variants) || root.variants.length < 1 || root.variants.length > 8) fail('recipe.variants', 'expected 1..8 variants');
  const names = new Set<string>();
  (root.variants as unknown[]).forEach((raw) => {
    const v = closed(raw, ['id', 'seed'], 'recipe.variants');
    if (typeof v.id !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/u.test(v.id) || names.has(v.id)) fail('recipe.variants', 'invalid or duplicate variant id');
    names.add(v.id as string); range(v.seed, 1, 0xffffffff, 'recipe.variants.seed');
    if (!Number.isInteger(v.seed)) fail('recipe.variants.seed', 'expected integer');
  });
  const layerIds = new Set();
  (root.layers as unknown[]).forEach((raw, index) => {
    const at = `${path}.layers[${index}]`;
    const layer = closed(raw, ['id', 'source', 'start', 'duration', 'gain', 'attack', 'release', 'highpass', 'lowpass'], at);
    if (typeof layer.id !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/u.test(layer.id) || layerIds.has(layer.id)) fail(at + '.id', 'invalid or duplicate layer id');
    layerIds.add(layer.id);
    range(layer.start, 0, root.duration as number, `${at}.start`);
    range(layer.duration, 0.02, root.duration as number, `${at}.duration`);
    if ((layer.start as number) + (layer.duration as number) > (root.duration as number) + 1e-9) fail(at, 'layer exceeds output duration');
    range(layer.gain, 0, 2, `${at}.gain`);
    range(layer.attack, 0.002, layer.duration as number, `${at}.attack`);
    range(layer.release, 0.002, layer.duration as number, `${at}.release`);
    if ((layer.attack as number) + (layer.release as number) > (layer.duration as number)) fail(at, 'fades overlap');
    range(layer.highpass, 10, 10000, `${at}.highpass`);
    range(layer.lowpass, 20, 16000, `${at}.lowpass`);
    if ((layer.highpass as number) >= (layer.lowpass as number)) fail(at, 'highpass must be below lowpass');
    const source = layer.source as RecordValue;
    if (!source || typeof source !== 'object') fail(`${at}.source`, 'expected source');
    if (source.kind === 'fm') {
      closed(source, ['kind', 'pitch', 'ratio', 'index', 'sweepSeconds', 'vibratoHz', 'vibratoCents'], `${at}.source`);
      range(source.sweepSeconds, 0.02, 5, `${at}.source.sweepSeconds`);
      pair(source.pitch, 40, 3000, `${at}.source.pitch`);
      range(source.ratio, 0.25, 4, `${at}.source.ratio`);
      range(source.index, 0, 4, `${at}.source.index`);
      range(source.vibratoHz, 0, 25, `${at}.source.vibratoHz`);
      range(source.vibratoCents, 0, 100, `${at}.source.vibratoCents`);
    } else if (source.kind === 'vocal') {
      closed(source, ['kind', 'pitch', 'sweepSeconds', 'formants', 'bandwidths', 'breath', 'jitter', 'roughness'], `${at}.source`);
      pair(source.pitch, 50, 1200, `${at}.source.pitch`);
      range(source.sweepSeconds, .02, 5, `${at}.source.sweepSeconds`);
      for (const key of ['formants', 'bandwidths']) {
        if (!Array.isArray(source[key]) || source[key].length !== 3) fail(at, 'expected three resonances');
        (source[key] as unknown[]).forEach((v) => range(v, key === 'formants' ? 150 : 40, key === 'formants' ? 7000 : 1500, `${at}.source.${key}`));
      }
      for (const key of ['breath', 'jitter', 'roughness']) range(source[key], 0, 1, `${at}.source.${key}`);
    } else if (source.kind === 'chirp') {
      const sourcePath = `${at}.source`;
      closed(source, ['kind', 'contour', 'trillHz', 'trillCents', 'trillDepth', 'breath', 'jitterCents', 'brightness'], sourcePath);
      if (!Array.isArray(source.contour) || source.contour.length < 2 || source.contour.length > 12) fail(`${sourcePath}.contour`, 'expected 2..12 pitch points');
      let previous = -1;
      (source.contour as unknown[]).forEach((rawPoint, pointIndex, points) => {
        const pointPath = `${sourcePath}.contour[${pointIndex}]`;
        const point = closed(rawPoint, ['at', 'hz'], pointPath);
        range(point.at, 0, 1, `${pointPath}.at`);
        range(point.hz, 500, 8000, `${pointPath}.hz`);
        if ((point.at as number) <= previous) fail(`${pointPath}.at`, 'pitch points must strictly increase');
        if ((pointIndex === 0 && point.at !== 0) || (pointIndex === points.length - 1 && point.at !== 1)) fail(`${pointPath}.at`, 'contour must span 0..1');
        previous = point.at as number;
      });
      range(source.trillHz, 0, 100, `${sourcePath}.trillHz`);
      range(source.trillCents, 0, 300, `${sourcePath}.trillCents`);
      range(source.trillDepth, 0, 1, `${sourcePath}.trillDepth`);
      range(source.breath, 0, .2, `${sourcePath}.breath`);
      range(source.jitterCents, 0, 80, `${sourcePath}.jitterCents`);
      range(source.brightness, 0, 1, `${sourcePath}.brightness`);
    } else if (source.kind === 'noise') closed(source, ['kind'], `${at}.source`);
    else fail(`${at}.source.kind`, 'unsupported source');
  });
  return freeze(JSON.parse(JSON.stringify(root))) as SoundRecipe;
};
