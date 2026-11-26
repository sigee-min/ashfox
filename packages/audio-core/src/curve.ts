import type { Control, Curve, SoundVoice } from './contract';

export const frame = (seconds: number): number => Math.floor(seconds * 48000 + 0.5);

interface CurveSegment {
  readonly startAt: number;
  readonly endAt: number;
  readonly dt: number;
  readonly aValue: number;
  readonly bValue: number;
  readonly logA: number;
  readonly logB: number;
}

interface CompiledCurve {
  readonly isLog: boolean;
  readonly isSmooth: boolean;
  readonly segments: readonly CurveSegment[];
  index: number;
}

const compiledCurves = new WeakMap<Curve, CompiledCurve>();

const compileCurve = (curve: Curve): CompiledCurve => {
  const isLog = curve.domain === 'log';
  const points = curve.points;
  const segments: CurveSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    segments.push({
      startAt: a.at,
      endAt: b.at,
      dt: b.at - a.at,
      aValue: a.value,
      bValue: b.value,
      logA: isLog ? Math.log(a.value) : 0,
      logB: isLog ? Math.log(b.value) : 0,
    });
  }
  return {
    isLog,
    isSmooth: curve.interpolation === 'smooth',
    segments,
    index: 0,
  };
};

const selectSegment = (compiled: CompiledCurve, u: number): CurveSegment => {
  const { segments } = compiled;
  const lastSeg = segments.length - 1;
  if (lastSeg === 0) return segments[0]!;
  let index = compiled.index;
  if (index > 0 && !(u > segments[index]!.startAt)) {
    index = u <= segments[0]!.endAt ? 0 : index - 1;
    while (index > 0 && !(u > segments[index]!.startAt)) index--;
  }
  while (index < lastSeg && u > segments[index]!.endAt) index++;
  compiled.index = index;
  return segments[index]!;
};

export const evaluate = (control: Control, u: number): number => {
  if (typeof control === 'number') return control;
  let compiled = compiledCurves.get(control);
  if (!compiled) {
    compiled = compileCurve(control);
    compiledCurves.set(control, compiled);
  }
  const seg = selectSegment(compiled, u);
  const v = Math.max(0, Math.min(1, (u - seg.startAt) / seg.dt));
  const w = compiled.isSmooth ? v * v * (3 - 2 * v) : v;
  if (w === 0) return seg.aValue;
  if (w === 1) return seg.bValue;
  return compiled.isLog
    ? Math.exp(seg.logA * (1 - w) + seg.logB * w)
    : seg.aValue * (1 - w) + seg.bValue * w;
};

export const bounds = (control: Control): readonly [number, number] =>
  typeof control === 'number'
    ? [control, control]
    : [
        Math.min(...control.points.map((p) => p.value)),
        Math.max(...control.points.map((p) => p.value)),
      ];

const pushSourceControls = (result: [string, Control][], s: SoundVoice['source']): void => {
  if ('pitch' in s && s.pitch !== undefined) result.push(['source.pitch', s.pitch]);
  if (s.kind === 'osc' && s.pulseWidth !== undefined) {
    result.push(['source.pulseWidth', s.pulseWidth]);
  }
  if (s.kind === 'fm') result.push(['source.index', s.index]);
  if (s.kind === 'chirp') result.push(['source.brightness', s.brightness]);
  if (s.kind === 'granular') result.push(['source.density', s.density]);
  if (s.kind === 'vocal' && s.formants) {
    s.formants.forEach((f, i) => result.push([`source.formants[${i}]`, f]));
  }
  if (s.kind === 'whoosh') {
    result.push(['source.velocity', s.velocity]);
    if (s.sweepPan !== undefined) result.push(['source.sweepPan', s.sweepPan]);
  }
};

export const controls = (voice: SoundVoice): readonly (readonly [string, Control])[] => {
  const result: [string, Control][] = [];
  if (!(typeof voice.gain === 'object' && 'env' in voice.gain)) result.push(['gain', voice.gain]);
  if (voice.highpass !== undefined) result.push(['highpass', voice.highpass]);
  if (voice.lowpass !== undefined) result.push(['lowpass', voice.lowpass]);
  if (voice.filter) {
    result.push(['filter.cutoff', voice.filter.cutoff]);
    if (voice.filter.q !== undefined) result.push(['filter.q', voice.filter.q]);
  }
  if (voice.pan !== undefined) result.push(['pan', voice.pan]);
  pushSourceControls(result, voice.source);
  return result;
};
