export interface ParsedBlockItem {
  readonly kind: 'prop' | 'block';
  readonly key: string;
  readonly tag: string | null;
  readonly value: unknown;
}

const SNAKE_TO_CAMEL: Readonly<Record<string, string>> = {
  pitch_cents: 'pitchCents',
  detune_cents: 'detuneCents',
  vibrato_hz: 'vibratoHz',
  vibrato_cents: 'vibratoCents',
  trill_hz: 'trillHz',
  trill_cents: 'trillCents',
  trill_depth: 'trillDepth',
  jitter_cents: 'jitterCents',
  pulse_width: 'pulseWidth',
  grain_ms: 'grainMs',
  pitch_drop_cents: 'pitchDropCents',
  pitch_drop_seconds: 'pitchDropSeconds',
  pre_delay: 'preDelayMs',
  pre_delay_ms: 'preDelayMs',
  gain_db: 'gainDb',
  peak_db: 'peakDb',
  target_lufs: 'targetLufs',
  xfade: 'crossfade',
};

const VOICE_LEVEL_KEYS = new Set(['gain', 'highpass', 'lowpass', 'filter', 'drive', 'pan']);
const VARY_STEP_KEYS: Readonly<Record<string, string>> = {
  vary_timing: 'timing',
  vary_pitch: 'pitchCents',
  vary_gain: 'gain',
  vary_duration: 'duration',
};

export const mapSoundKey = (key: string): string => SNAKE_TO_CAMEL[key] ?? key;

export const lowerBlockProps = (
  items: readonly ParsedBlockItem[],
  fail: (msg: string) => never,
): Record<string, unknown> => {
  const out: Record<string, unknown> = Object.create(null);
  for (const item of items) {
    const k = mapSoundKey(item.key);
    if (k in out) fail(`duplicate property ${item.key}`);
    out[k] = item.value;
  }
  return out;
};

export const lowerSubBlock = (
  kind: string,
  tag: string | null,
  rawItems: readonly ParsedBlockItem[],
  fail: (msg: string) => never,
): Record<string, unknown> => {
  const rec = lowerBlockProps(rawItems, fail);
  if (tag !== null && (kind === 'filter' || kind === 'excitation' || kind === 'source')) {
    if ('kind' in rec) fail(`duplicate kind in ${kind}`);
    return { kind: tag, ...rec };
  }
  return rec;
};

const applyVoiceItem = (
  item: ParsedBlockItem,
  sourceKind: string | null,
  voice: Record<string, unknown>,
  source: Record<string, unknown>,
  modes: Record<string, unknown>[],
  formants: Record<string, unknown>[],
  fail: (msg: string) => never,
): void => {
  if (item.kind === 'block' && item.key === 'mode') {
    if (!item.tag) fail(`mode requires an identifier`);
    modes.push({ id: item.tag, ...(item.value as Record<string, unknown>) });
    return;
  }
  if (item.kind === 'block' && item.key === 'formant') {
    formants.push(item.value as Record<string, unknown>);
    return;
  }
  const mapped = mapSoundKey(item.key);
  const target =
    VOICE_LEVEL_KEYS.has(mapped) || (mapped === 'source' && !sourceKind) ? voice : source;
  if (mapped in target) fail(`duplicate voice property ${item.key}`);
  target[mapped] = item.value;
};

export const lowerVoiceBlock = (
  id: string,
  sourceKind: string | null,
  items: readonly ParsedBlockItem[],
  fail: (msg: string) => never,
): Record<string, unknown> => {
  const voice: Record<string, unknown> = { id };
  const source: Record<string, unknown> = sourceKind ? { kind: sourceKind } : {};
  const modes: Record<string, unknown>[] = [];
  const formants: Record<string, unknown>[] = [];
  for (const item of items) applyVoiceItem(item, sourceKind, voice, source, modes, formants, fail);
  if (modes.length > 0) {
    if ('modes' in source) fail('cannot mix modes list with mode blocks');
    source.modes = modes;
  }
  if (formants.length > 0) {
    if ('formants' in source) fail('cannot mix formants list with formant blocks');
    source.formants = formants;
  }
  if (!('source' in voice)) voice.source = source;
  return voice;
};

const lowerStepBlock = (
  id: string,
  items: readonly ParsedBlockItem[],
  fail: (msg: string) => never,
): Record<string, unknown> => {
  const step: Record<string, unknown> = { id };
  const vary: Record<string, unknown> = {};
  for (const item of items) {
    const varyKey = VARY_STEP_KEYS[item.key];
    if (varyKey) {
      if (varyKey in vary) fail(`duplicate step property ${item.key}`);
      vary[varyKey] = item.value;
      continue;
    }
    const mapped = mapSoundKey(item.key);
    if (mapped in step) fail(`duplicate step property ${item.key}`);
    step[mapped] = item.value;
  }
  if (Object.keys(vary).length > 0) {
    if ('vary' in step) fail('cannot mix vary block with vary_* properties');
    step.vary = vary;
  }
  return step;
};

export const lowerSeqBlock = (
  id: string,
  items: readonly ParsedBlockItem[],
  fail: (msg: string) => never,
): Record<string, unknown> => {
  const seq: Record<string, unknown> = { id };
  const steps: Record<string, unknown>[] = [];
  for (const item of items) {
    if (item.kind === 'block' && item.key === 'step') {
      if (!item.tag) fail('step requires an identifier');
      steps.push(lowerStepBlock(item.tag, item.value as ParsedBlockItem[], fail));
      continue;
    }
    const mapped = mapSoundKey(item.key);
    if (mapped in seq) fail(`duplicate sequence property ${item.key}`);
    seq[mapped] = item.value;
  }
  if (steps.length > 0) {
    if ('steps' in seq) fail('cannot mix steps list with step blocks');
    seq.steps = steps;
  }
  if (!('start' in seq)) seq.start = 0;
  return seq;
};

export const lowerMasterBlock = (
  items: readonly ParsedBlockItem[],
  fail: (msg: string) => never,
): Record<string, unknown> => {
  const out: Record<string, unknown> = Object.create(null);
  for (const item of items) {
    const k =
      item.key === 'gain'
        ? 'gainDb'
        : item.key === 'peak'
          ? 'peakDb'
          : item.key === 'target'
            ? 'targetLufs'
            : mapSoundKey(item.key);
    if (k in out) fail(`duplicate master property ${item.key}`);
    out[k] = item.value;
  }
  if (!('gainDb' in out) && 'targetLufs' in out) out.gainDb = 0;
  return out;
};

export const lowerLoopBlock = (
  items: readonly ParsedBlockItem[],
  fail: (msg: string) => never,
): Record<string, unknown> => {
  const out: Record<string, unknown> = { kind: 'loop' };
  for (const item of items) {
    if (item.key === 'at') {
      if (!Array.isArray(item.value) || item.value.length !== 2) fail('loop at requires a..b');
      if ('start' in out || 'end' in out) fail('duplicate loop property at');
      out.start = item.value[0];
      out.end = item.value[1];
      continue;
    }
    const k = mapSoundKey(item.key);
    if (k in out) fail(`duplicate loop property ${item.key}`);
    out[k] = item.value;
  }
  return out;
};

export const lowerSpaceBlock = (
  items: readonly ParsedBlockItem[],
  fail: (msg: string) => never,
): Record<string, unknown> => {
  const out: Record<string, unknown> = Object.create(null);
  for (const item of items) {
    const k = mapSoundKey(item.key);
    if (k in out) fail(`duplicate space property ${item.key}`);
    out[k] = item.value;
  }
  return out;
};
