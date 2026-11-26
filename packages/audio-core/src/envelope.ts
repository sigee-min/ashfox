import type { EnvelopeControl, GainControl } from './contract';
import { bounds, evaluate } from './curve';

export const isEnvelopeControl = (value: GainControl): value is EnvelopeControl =>
  typeof value === 'object' && 'env' in value;

export const gainBounds = (control: GainControl): readonly [number, number] => {
  if (!isEnvelopeControl(control)) return bounds(control);
  const peak = control.peak ?? 1;
  return [0, peak];
};

const shape = (u: number, curve: 'linear' | 'exp' | undefined): number => {
  const c = Math.max(0, Math.min(1, u));
  return curve === 'exp' ? c * c : c;
};

export const evaluateGain = (
  control: GainControl,
  frameIndex: number,
  totalFrames: number,
  rate: number,
): number => {
  if (!isEnvelopeControl(control))
    return evaluate(control, frameIndex / Math.max(1, totalFrames - 1));
  if (frameIndex === 0 || frameIndex >= totalFrames - 1) return 0;
  const t = frameIndex / rate;
  const totalSec = (totalFrames - 1) / rate;
  const peak = control.peak ?? 1;
  if (control.env === 'ad') {
    if (t < control.attack) return peak * shape(t / control.attack, control.curve);
    const rem = Math.max(1e-6, totalSec - control.attack);
    const fall = 1 - (t - control.attack) / rem;
    return peak * shape(fall, control.curve);
  }
  const relStart = totalSec - control.release;
  if (t >= relStart) {
    return peak * control.sustain * shape((totalSec - t) / control.release, control.curve);
  }
  if (t < control.attack) return peak * shape(t / control.attack, control.curve);
  const decEnd = control.attack + control.decay;
  if (t < decEnd) {
    const f = 1 - shape((t - control.attack) / control.decay, control.curve);
    return peak * (control.sustain + (1 - control.sustain) * f);
  }
  return peak * control.sustain;
};
