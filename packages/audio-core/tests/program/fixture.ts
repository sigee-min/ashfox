import type { Control, GainControl, SoundRecipe, SoundSource, SoundVoice } from '../../src';

export const envelope = (peak = 1): Control => ({
  domain: 'linear',
  interpolation: 'smooth',
  points: [
    { at: 0, value: 0 },
    { at: 0.1, value: peak },
    { at: 0.9, value: peak },
    { at: 1, value: 0 },
  ],
});

export const fixture = (): SoundRecipe => ({
  id: 'test',
  profile: 'ui',
  duration: 1,
  sample_rate: 48000,
  channels: 1,
  seed: 123,
  voices: [
    {
      id: 'tone',
      source: { kind: 'fm', pitch: 440, ratio: 1, index: 0, vibratoHz: 0, vibratoCents: 0 },
      gain: envelope(),
      highpass: 10,
      lowpass: 16000,
    },
  ],
  sequences: [
    {
      id: 'phrase',
      start: 0,
      repeat: { count: 1, period: 0 },
      steps: [
        {
          id: 'note',
          voice: 'tone',
          at: 0,
          duration: 1,
          gain: 1,
          pitchCents: 0,
          vary: { timing: [0, 0], pitchCents: [0, 0], gain: [1, 1], duration: [1, 1] },
        },
      ],
    },
  ],
  variants: [
    { id: 'base', seed: 42 },
    { id: 'alternate', seed: 43 },
  ],
  playback: { kind: 'oneshot' },
  output: { gainDb: -12, peakDb: -3 },
});

const KEY_SNAKE: Record<string, string> = {
  pulseWidth: 'pulse_width',
  detuneCents: 'detune_cents',
  vibratoHz: 'vibrato_hz',
  vibratoCents: 'vibrato_cents',
  trillHz: 'trill_hz',
  trillCents: 'trill_cents',
  trillDepth: 'trill_depth',
  jitterCents: 'jitter_cents',
  twinBeat: 'twin_beat',
  stereoSpread: 'stereo_spread',
  grainMs: 'grain_ms',
  stereoWidth: 'stereo_width',
  itdMs: 'itd_ms',
  sweepPan: 'sweep_pan',
  noiseTone: 'noise_tone',
  bowPressure: 'bow_pressure',
};

const FIELD_UNIT: Record<string, string> = {
  pitch: 'hz',
  vibratoHz: 'hz',
  trillHz: 'hz',
  detuneCents: 'cents',
  vibratoCents: 'cents',
  trillCents: 'cents',
  jitterCents: 'cents',
  grainMs: 'ms',
  itdMs: 'ms',
};

const fmtCtrl = (c: Control, unit = ''): string => {
  if (typeof c === 'number') return `${c}${unit}`;
  const fn = c.domain === 'log' ? 'log' : c.interpolation === 'smooth' ? 'smooth' : 'lin';
  return `${fn}(${c.points.map((p) => `${p.at}: ${p.value}${unit}`).join(' -> ')})`;
};

const fmtGain = (g: GainControl): string => {
  if (typeof g === 'object' && 'env' in g) {
    const parts = [
      `env = ${g.env}`,
      `attack = ${g.attack}s`,
      ...(g.env === 'adsr'
        ? [`decay = ${g.decay}s`, `sustain = ${g.sustain}`, `release = ${g.release}s`]
        : []),
      ...(g.peak !== undefined ? [`peak = ${g.peak}`] : []),
      ...(g.curve !== undefined ? [`curve = ${g.curve}`] : []),
    ];
    return `gain { ${parts.join('; ')}; }`;
  }
  return `gain = ${fmtCtrl(g)};`;
};

const fmtAttrVal = (k: string, v: unknown): string => {
  if (Array.isArray(v)) return `(${v.map((x) => fmtAttrVal(k, x)).join(', ')})`;
  if (typeof v === 'string') return v;
  const unit = FIELD_UNIT[k] ?? '';
  return typeof v === 'number' || (v && typeof v === 'object' && 'points' in v)
    ? fmtCtrl(v as Control, unit)
    : String(v);
};

const fmtVoice = (v: SoundVoice): string => {
  const s = v.source as unknown as Record<string, unknown>;
  const lines = Object.entries(s)
    .filter(([k, val]) => k !== 'kind' && val !== undefined)
    .map(([k, val]) => `${KEY_SNAKE[k] ?? k} = ${fmtAttrVal(k, val)};`);
  if (v.highpass !== undefined) lines.push(`highpass = ${fmtCtrl(v.highpass, 'hz')};`);
  if (v.lowpass !== undefined) lines.push(`lowpass = ${fmtCtrl(v.lowpass, 'hz')};`);
  if (v.filter) {
    const q = v.filter.q !== undefined ? ` q = ${fmtCtrl(v.filter.q)};` : '';
    lines.push(`filter : ${v.filter.kind} { cutoff = ${fmtCtrl(v.filter.cutoff, 'hz')};${q} }`);
  }
  if (v.drive !== undefined) {
    lines.push(
      typeof v.drive === 'number'
        ? `drive = ${v.drive};`
        : `drive : ${v.drive.mode} { amount = ${v.drive.amount}; }`,
    );
  }
  if (v.pan !== undefined) lines.push(`pan = ${fmtCtrl(v.pan)};`);
  lines.push(fmtGain(v.gain));
  return `  voice ${v.id} : ${v.source.kind} {\n    ${lines.join('\n    ')}\n  }`;
};

const SPACE_FIELDS: Record<string, readonly [string, string]> = {
  preset: ['preset', ''],
  mix: ['mix', ''],
  decay: ['decay', 's'],
  damping: ['damping', 'hz'],
  size: ['size', ''],
  preDelayMs: ['pre_delay_ms', 'ms'],
  width: ['width', ''],
};

const VARY_FIELDS: Record<string, readonly [string, string]> = {
  timing: ['vary_timing', 's'],
  pitchCents: ['vary_pitch', 'cents'],
  gain: ['vary_gain', ''],
  duration: ['vary_duration', ''],
};

export const native = (recipe: SoundRecipe): string => {
  const lines: string[] = [
    `  profile = ${recipe.profile};`,
    `  duration = ${recipe.duration}s;`,
    `  sample_rate = ${recipe.sample_rate}hz;`,
    ...(recipe.channels !== undefined ? [`  channels = ${recipe.channels};`] : []),
    `  seed = ${recipe.seed};`,
  ];
  if (recipe.space) {
    const attrs = Object.entries(recipe.space)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => {
        const [sk, u] = SPACE_FIELDS[k] ?? [k, ''];
        return `${sk} = ${v}${u};`;
      })
      .join(' ');
    lines.push(`  space { ${attrs} }`);
  }
  for (const v of recipe.voices) lines.push(fmtVoice(v));
  for (const seq of recipe.sequences) {
    const inner: string[] = [`    start = ${seq.start}s;`];
    if (seq.repeat && seq.repeat.count > 1) {
      inner.push(`    repeat { count = ${seq.repeat.count}; period = ${seq.repeat.period}s; }`);
    }
    for (const st of seq.steps) {
      const attrs = [
        `voice = ${st.voice};`,
        `at = ${st.at}s;`,
        `duration = ${st.duration}s;`,
        ...(st.gain !== undefined ? [`gain = ${st.gain};`] : []),
        ...(st.pitchCents !== undefined ? [`pitch = ${st.pitchCents}cents;`] : []),
        ...(st.vary
          ? Object.entries(st.vary)
              .filter(([, r]) => r !== undefined)
              .map(([k, r]) => {
                const [vk, u] = VARY_FIELDS[k]!;
                const [a, b] = r as readonly [number, number];
                return `${vk} = ${a}${u}..${b}${u};`;
              })
          : []),
      ];
      inner.push(`    step ${st.id} { ${attrs.join(' ')} }`);
    }
    lines.push(`  seq ${seq.id} {\n${inner.join('\n')}\n  }`);
  }
  lines.push(`  variants { ${recipe.variants.map((v) => `${v.id} = ${v.seed};`).join(' ')} }`);
  lines.push(
    recipe.playback.kind === 'oneshot'
      ? '  playback = oneshot;'
      : `  loop { at = ${recipe.playback.start}s..${recipe.playback.end}s; xfade = ${recipe.playback.crossfade}s; }`,
  );
  const m = recipe.output;
  const mAttrs = [
    `gain = ${m.gainDb}db;`,
    `peak = ${m.peakDb}db;`,
    ...(m.targetLufs !== undefined ? [`target = ${m.targetLufs}lufs;`] : []),
    ...(m.punch !== undefined ? [`punch = ${m.punch};`] : []),
    ...(m.warmth !== undefined ? [`warmth = ${m.warmth};`] : []),
    ...(m.air !== undefined ? [`air = ${m.air};`] : []),
    ...(m.glue !== undefined ? [`glue = ${m.glue};`] : []),
    ...(m.width !== undefined ? [`width = ${m.width};`] : []),
    ...(m.limit ? ['limit = true;'] : []),
  ];
  lines.push(`  master { ${mAttrs.join(' ')} }`);
  return `ashfox 1\nsound ${recipe.id} {\n${lines.join('\n')}\n}`;
};
