export type SvfKind = 'lowpass' | 'highpass' | 'bandpass' | 'notch';

/** Cytomic ZDF State-Variable Filter — unconditionally stable under fast cutoff/Q sweeps. */
export const createSvf = (kind: SvfKind, rate: number) => {
  let ic1eq = 0;
  let ic2eq = 0;
  const maxHz = rate * 0.45;
  return (x: number, cutoffHz: number, q = 0.7071): number => {
    const hz = Math.max(10, Math.min(maxHz, cutoffHz));
    const g = Math.tan((Math.PI * hz) / rate);
    const k = 1 / Math.max(0.5, q);
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
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
