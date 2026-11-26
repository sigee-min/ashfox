import type { SoundRecipe, Control } from '../../src';

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

const SNAKE_MAP: Readonly<Record<string, string>> = {
  pitchCents: 'pitch_cents',
  detuneCents: 'detune_cents',
  vibratoHz: 'vibrato_hz',
  vibratoCents: 'vibrato_cents',
  trillHz: 'trill_hz',
  trillCents: 'trill_cents',
  trillDepth: 'trill_depth',
  jitterCents: 'jitter_cents',
  pulseWidth: 'pulse_width',
  grainMs: 'grain_ms',
  pitchDropCents: 'pitch_drop_cents',
  pitchDropSeconds: 'pitch_drop_seconds',
  preDelayMs: 'pre_delay',
  gainDb: 'gain_db',
  peakDb: 'peak_db',
  targetLufs: 'target_lufs',
};

const fmtCtrl = (v: unknown): string => {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return `[${v.map(fmtCtrl).join(', ')}]`;
  if (v && typeof v === 'object' && 'points' in v) {
    const c = v as {
      domain: string;
      interpolation: string;
      points: { at: number; value: number }[];
    };
    const pts = c.points.map((p) => `(${p.at}, ${p.value})`).join(', ');
    return `{ domain = ${c.domain}; interpolation = ${c.interpolation}; points = [${pts}]; }`;
  }
  return String(v);
};

const fmtFormants = (formants: readonly unknown[]): string => {
  const items = formants.map((f) => {
    if (typeof f === 'number') return String(f);
    const c = f as { points: { at: number; value: number }[]; interpolation: string };
    const vals = c.points.map((p) => String(p.value));
    return c.interpolation === 'linear' ? vals.join(' -> ') + ' linear' : vals.join(' -> ');
  });
  return `    formants = [${items.join(', ')}];`;
};

const fmtProp = (k: string, v: unknown, ind: string): string => {
  const sk = SNAKE_MAP[k] ?? k;
  if (k === 'formants' && Array.isArray(v)) return fmtFormants(v);
  if (v && typeof v === 'object' && !Array.isArray(v) && 'points' in v) {
    return `${ind}${sk} ${fmtCtrl(v)}`;
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const rec = v as Record<string, unknown>;
    const tag = 'kind' in rec ? ` ${String(rec.kind)}` : '';
    const inner = Object.entries(rec)
      .filter(([ek]) => ek !== 'kind')
      .map(([ek, ev]) => fmtProp(ek, ev, ind + '  '))
      .join('\n');
    return `${ind}${sk}${tag} {\n${inner}\n${ind}}`;
  }
  return `${ind}${sk} = ${fmtCtrl(v)};`;
};

export const native = (recipe: SoundRecipe): string => {
  const lines = [`ashfox 1`, `sound ${recipe.id} {`];
  lines.push(`  profile = ${recipe.profile};`);
  lines.push(`  duration = ${recipe.duration}s;`);
  if (recipe.channels !== undefined) lines.push(`  channels = ${recipe.channels};`);
  lines.push(`  seed = ${recipe.seed};`);
  if (recipe.space) {
    lines.push(
      `  space {\n${Object.entries(recipe.space)
        .map(([k, v]) => fmtProp(k, v, '    '))
        .join('\n')}\n  }`,
    );
  }
  for (const v of recipe.voices) {
    const src = v.source as unknown as Record<string, unknown>;
    lines.push(`  voice ${v.id} : ${String(src.kind)} {`);
    for (const [k, val] of Object.entries(src)) {
      if (k === 'kind') continue;
      if (k === 'modes' && Array.isArray(val)) {
        for (const m of val as Record<string, unknown>[]) {
          lines.push(
            `    mode ${String(m.id)} { hz = ${m.hz}hz; decay = ${m.decay}s; gain = ${m.gain}; }`,
          );
        }
      } else lines.push(fmtProp(k, val, '    '));
    }
    for (const [vk, vv] of Object.entries(v)) {
      if (vk === 'id' || vk === 'source' || vv === undefined) continue;
      lines.push(fmtProp(vk, vv, '    '));
    }
    lines.push(`  }`);
  }
  for (const s of recipe.sequences) {
    lines.push(`  seq ${s.id} {\n    start = ${s.start}s;`);
    if (s.repeat)
      lines.push(`    repeat { count = ${s.repeat.count}; period = ${s.repeat.period}s; }`);
    for (const st of s.steps) {
      lines.push(`    step ${st.id} {`);
      lines.push(`      voice = ${st.voice}; at = ${st.at}s; duration = ${st.duration}s;`);
      if (st.gain !== undefined) lines.push(`      gain = ${st.gain};`);
      if (st.pitchCents !== undefined) lines.push(`      pitch_cents = ${st.pitchCents}cents;`);
      if (st.vary) {
        if (st.vary.timing)
          lines.push(`      vary_timing = ${st.vary.timing[0]}s..${st.vary.timing[1]}s;`);
        if (st.vary.pitchCents)
          lines.push(
            `      vary_pitch = ${st.vary.pitchCents[0]}cents..${st.vary.pitchCents[1]}cents;`,
          );
        if (st.vary.gain) lines.push(`      vary_gain = ${st.vary.gain[0]}..${st.vary.gain[1]};`);
        if (st.vary.duration)
          lines.push(`      vary_duration = ${st.vary.duration[0]}..${st.vary.duration[1]};`);
      }
      lines.push(`    }`);
    }
    lines.push(`  }`);
  }
  for (const vr of recipe.variants) lines.push(`  variant ${vr.id} { seed = ${vr.seed}; }`);
  if (recipe.playback.kind === 'loop') {
    lines.push(
      `  loop { at = ${recipe.playback.start}s..${recipe.playback.end}s; xfade = ${recipe.playback.crossfade}s; }`,
    );
  }
  lines.push(
    `  output {\n${Object.entries(recipe.output)
      .map(([k, v]) => fmtProp(k, v, '    '))
      .join('\n')}\n  }`,
  );
  lines.push('}');
  return lines.join('\n');
};
