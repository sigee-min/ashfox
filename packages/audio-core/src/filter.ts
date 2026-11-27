import type { SoundVoice } from './contract';
import { evaluate } from './curve';

export type SvfKind = 'lowpass' | 'highpass' | 'bandpass' | 'notch';

/** Cytomic ZDF State-Variable Filter with 16-sample control-rate coefficient updates. */
export const createSvf = (kind: SvfKind, rate: number) => {
  let ic1eq = 0;
  let ic2eq = 0;
  const maxHz = rate * 0.45;
  let lastHz = NaN;
  let lastQ = NaN;
  let k = 0;
  let a1 = 0;
  let a2 = 0;
  let a3 = 0;
  let hold = 0;
  return (x: number, cutoffHz: number, q = 0.7071): number => {
    const hz = Math.max(10, Math.min(maxHz, cutoffHz));
    if (hold === 0 && (hz !== lastHz || q !== lastQ)) {
      lastHz = hz;
      lastQ = q;
      const g = Math.tan((Math.PI * hz) / rate);
      k = 1 / Math.max(0.5, q);
      a1 = 1 / (1 + g * (g + k));
      a2 = g * a1;
      a3 = g * a2;
    }
    hold = (hold + 1) & 15;
    const v3 = x - ic2eq;
    const v1 = a1 * ic1eq + a2 * v3;
    const v2 = ic2eq + a2 * ic1eq + a3 * v3;
    ic1eq = 2 * v1 - ic1eq;
    ic2eq = 2 * v2 - ic2eq;
    if (kind === 'lowpass') return v2;
    if (kind === 'bandpass') return v1;
    if (kind === 'highpass') return x - k * v1 - v2;
    return x - k * v1;
  };
};

export interface StereoSvfNode {
  readonly setCoeffs: (cutoffHz: number, q?: number) => void;
  readonly process: (lr: Float64Array) => void;
}

interface StereoSvfState {
  ic1L: number;
  ic2L: number;
  ic1R: number;
  ic2R: number;
  lastHz: number;
  lastQ: number;
  k: number;
  a1: number;
  a2: number;
  a3: number;
}

const stepSvfPair = (st: StereoSvfState, kind: SvfKind, lr: Float64Array): void => {
  const { k, a1, a2, a3 } = st;
  const xL = lr[0]!,
    xR = lr[1]!;
  const v3L = xL - st.ic2L,
    v1L = a1 * st.ic1L + a2 * v3L,
    v2L = st.ic2L + a2 * st.ic1L + a3 * v3L;
  const v3R = xR - st.ic2R,
    v1R = a1 * st.ic1R + a2 * v3R,
    v2R = st.ic2R + a2 * st.ic1R + a3 * v3R;
  st.ic1L = 2 * v1L - st.ic1L;
  st.ic2L = 2 * v2L - st.ic2L;
  st.ic1R = 2 * v1R - st.ic1R;
  st.ic2R = 2 * v2R - st.ic2R;
  if (kind === 'lowpass') {
    lr[0] = v2L;
    lr[1] = v2R;
  } else if (kind === 'bandpass') {
    lr[0] = v1L;
    lr[1] = v1R;
  } else if (kind === 'highpass') {
    lr[0] = xL - k * v1L - v2L;
    lr[1] = xR - k * v1R - v2R;
  } else {
    lr[0] = xL - k * v1L;
    lr[1] = xR - k * v1R;
  }
};

/** Shared-coefficient stereo Cytomic ZDF State-Variable Filter. */
export const createStereoSvf = (kind: SvfKind, rate: number): StereoSvfNode => {
  const st: StereoSvfState = {
    ic1L: 0,
    ic2L: 0,
    ic1R: 0,
    ic2R: 0,
    lastHz: NaN,
    lastQ: NaN,
    k: 0,
    a1: 0,
    a2: 0,
    a3: 0,
  };
  const maxHz = rate * 0.45;
  const piOverRate = Math.PI / rate;
  return {
    setCoeffs: (cutoffHz: number, q = 0.7071): void => {
      const hz = Math.max(10, Math.min(maxHz, cutoffHz));
      if (hz === st.lastHz && q === st.lastQ) return;
      st.lastHz = hz;
      st.lastQ = q;
      const g = Math.tan(piOverRate * hz);
      st.k = 1 / Math.max(0.5, q);
      st.a1 = 1 / (1 + g * (g + st.k));
      st.a2 = g * st.a1;
      st.a3 = g * st.a2;
    },
    process: (lr: Float64Array): void => stepSvfPair(st, kind, lr),
  };
};

export interface StereoFilterBank {
  readonly hp: StereoSvfNode | null;
  readonly svf: StereoSvfNode | null;
  readonly lp: StereoSvfNode | null;
  readonly anyDynamic: boolean;
}

const isCurve = (c: unknown): boolean => typeof c === 'object' && c !== null;

const initStereoFilter = (
  kind: SvfKind,
  rate: number,
  cutoff: SoundVoice['highpass'],
  q: SoundVoice['highpass'] = 0.7071,
): StereoSvfNode | null => {
  if (cutoff === undefined) return null;
  const node = createStereoSvf(kind, rate);
  if (typeof cutoff === 'number' && typeof q === 'number') node.setCoeffs(cutoff, q);
  return node;
};

/** Create the per-voice stereo highpass, SVF, and lowpass filter bank. */
export const createStereoFilterBank = (voice: SoundVoice, rate: number): StereoFilterBank => ({
  hp: initStereoFilter('highpass', rate, voice.highpass),
  svf: voice.filter
    ? initStereoFilter(voice.filter.kind, rate, voice.filter.cutoff, voice.filter.q)
    : null,
  lp: initStereoFilter('lowpass', rate, voice.lowpass),
  anyDynamic:
    voice.drift?.target === 'cutoff' ||
    isCurve(voice.highpass) ||
    isCurve(voice.lowpass) ||
    isCurve(voice.filter?.cutoff) ||
    isCurve(voice.filter?.q),
});

/** Update coefficients for active filters in a stereo filter bank at normalized time `u`. */
export const updateFilterCoeffs = (
  voice: SoundVoice,
  u: number,
  cutoffScale: number,
  bank: StereoFilterBank,
): void => {
  if (bank.hp && voice.highpass !== undefined) {
    bank.hp.setCoeffs(evaluate(voice.highpass, u) * cutoffScale, 0.7071);
  }
  if (bank.svf && voice.filter) {
    const q = voice.filter.q !== undefined ? evaluate(voice.filter.q, u) : 0.7071;
    bank.svf.setCoeffs(evaluate(voice.filter.cutoff, u) * cutoffScale, q);
  }
  if (bank.lp && voice.lowpass !== undefined) {
    bank.lp.setCoeffs(evaluate(voice.lowpass, u) * cutoffScale, 0.7071);
  }
};
