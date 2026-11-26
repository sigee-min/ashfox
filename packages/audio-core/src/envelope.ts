import type { EnvelopeControl, GainControl } from './contract';
import { bounds, evaluate } from './curve';

const EXP_K = Math.LN10 * 2;
const EXP_DENOM = Math.exp(EXP_K) - 1;

export const isEnvelopeControl = (value: GainControl): value is EnvelopeControl =>
  typeof value === 'object' && 'env' in value;

export const gainBounds = (control: GainControl): readonly [number, number] => {
  if (!isEnvelopeControl(control)) return bounds(control);
  const peak = control.peak ?? 1;
  return [0, peak];
};

const clamp01 = (u: number): number => Math.max(0, Math.min(1, u));

const shapeAttack = (u: number, curve: 'linear' | 'exp' | undefined): number => {
  const c = clamp01(u);
  if (curve !== 'exp') return c;
  const inv = 1 - c;
  return 1 - inv * inv;
};

const shapeDecay = (rem: number, curve: 'linear' | 'exp' | undefined): number => {
  const r = clamp01(rem);
  if (curve !== 'exp' || r === 0 || r === 1) return r;
  return (Math.exp(EXP_K * r) - 1) / EXP_DENOM;
};

export const evaluateGain = (
  control: GainControl,
  frameIndex: number,
  totalFrames: number,
  rate: number,
): number => {
  if (!isEnvelopeControl(control))
    return evaluate(control, frameIndex / Math.max(1, totalFrames - 1));
  if (frameIndex <= 0 || frameIndex >= totalFrames - 1) return 0;
  const t = frameIndex / rate;
  const totalSec = (totalFrames - 1) / rate;
  const peak = control.peak ?? 1;
  if (control.env === 'ad') {
    if (t < control.attack) return peak * shapeAttack(t / control.attack, control.curve);
    const rem = Math.max(1e-6, totalSec - control.attack);
    return peak * shapeDecay(1 - (t - control.attack) / rem, control.curve);
  }
  const relStart = totalSec - control.release;
  if (t >= relStart) {
    return (
      peak *
      control.sustain *
      shapeDecay((totalSec - t) / Math.max(1e-6, control.release), control.curve)
    );
  }
  if (t < control.attack) return peak * shapeAttack(t / control.attack, control.curve);
  const decEnd = control.attack + control.decay;
  if (t < decEnd) {
    const f = shapeDecay(1 - (t - control.attack) / Math.max(1e-6, control.decay), control.curve);
    return peak * (control.sustain + (1 - control.sustain) * f);
  }
  return peak * control.sustain;
};
