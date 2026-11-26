import type { WhooshSource } from './contract';
import { evaluate } from './curve';
import { createSvf } from './filter';

const TAU = Math.PI * 2;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

interface SmoothNoise {
  readonly stepFrames: number;
  frame: number;
  prev: number;
  next: number;
}

const stepSmooth = (node: SmoothNoise, rand: () => number): number => {
  if (node.frame >= node.stepFrames) {
    node.prev = node.next;
    node.next = rand();
    node.frame = 0;
  }
  const t = node.frame++ / node.stepFrames;
  const s = t * t * (3 - 2 * t);
  return node.prev + (node.next - node.prev) * s;
};

const findPeakProgress = (velocity: WhooshSource['velocity']): number => {
  if (typeof velocity === 'number') return 0.5;
  let bestU = 0.5;
  let bestV = -Infinity;
  const steps = 64;
  for (let k = 0; k <= steps; k++) {
    const u = k / steps;
    const v = evaluate(velocity, u);
    if (v > bestV) {
      bestV = v;
      bestU = u;
    }
  }
  return bestU;
};

type SvfNode = ReturnType<typeof createSvf>;

interface WhooshEngine {
  readonly source: WhooshSource;
  readonly rate: number;
  readonly pitchShift: number;
  readonly invLen: number;
  readonly thickness: number;
  readonly dopplerAmt: number;
  readonly noiseTone: number;
  readonly uPeak: number;
  readonly vortexBp1: SvfNode;
  readonly vortexBp2: SvfNode;
  readonly airLpL: SvfNode;
  readonly airLpR: SvfNode;
  readonly airHpL: SvfNode;
  readonly airHpR: SvfNode;
  readonly turbNode: SmoothNoise;
  readonly vortexRand: () => number;
  vortexPhase: number;
}

const sampleWhooshFrame = (e: WhooshEngine, i: number, outLR: Float64Array): void => {
  const u = i * e.invLen;
  const v = Math.max(0, evaluate(e.source.velocity, u));
  const pressure = Math.min(4, v * v * v);
  const dopplerCurve = 0.08 - 0.2 * (0.5 + 0.5 * Math.tanh((u - e.uPeak) * 6));
  const doppler = 1 + e.dopplerAmt * dopplerCurve;
  const turb = stepSmooth(e.turbNode, e.vortexRand);

  const vortexHz = clamp(
    ((220 + 720 * Math.max(0.06, v)) / Math.pow(e.thickness, 0.75)) *
      doppler *
      e.pitchShift *
      (0.92 + 0.16 * turb),
    45,
    e.rate * 0.42,
  );
  e.vortexPhase = (e.vortexPhase + (TAU * vortexHz) / e.rate) % TAU;

  const nL = e.vortexRand() * 2 - 1;
  const nR = e.vortexRand() * 2 - 1;
  const aeroNoise = 0.5 * (nL + nR);
  const whistleBand =
    e.vortexBp1(aeroNoise, vortexHz, 4.2 + 2.5 * v) * 0.85 +
    e.vortexBp2(aeroNoise, Math.min(e.rate * 0.42, vortexHz * 2.03), 5.0) * 0.35;
  const vortexTone = Math.sin(e.vortexPhase + 0.38 * Math.sin(e.vortexPhase * 2.07 + turb * 2.2));
  const shedding = whistleBand * (0.65 + 0.35 * (1 - e.noiseTone)) + vortexTone * (0.18 + 0.14 * v);

  const hissCutoff = clamp(
    (420 + 4200 * e.noiseTone) * (0.35 + 0.85 * v) * doppler * e.pitchShift,
    80,
    e.rate * 0.44,
  );
  const hpCutoff = clamp(120 + 380 * e.noiseTone, 60, hissCutoff * 0.6);
  const airL = e.airHpL(e.airLpL(nL, hissCutoff, 0.75), hpCutoff, 0.7071);
  const airR = e.airHpR(e.airLpR(nR, hissCutoff, 0.75), hpCutoff, 0.7071);

  const pan =
    e.source.sweepPan !== undefined
      ? clamp(evaluate(e.source.sweepPan, u), -1, 1)
      : Math.tanh((u - e.uPeak) * 4.5) * 0.82;
  const angle = ((pan + 1) * Math.PI) / 4;
  const toneWeight = 0.45 + 0.35 * (1 - e.noiseTone);
  const airWeight = 0.45 + 0.45 * e.noiseTone;
  const core = shedding * toneWeight;
  outLR[0] = (core + airL * airWeight) * pressure * Math.cos(angle);
  outLR[1] = (core + airR * airWeight) * pressure * Math.sin(angle);
};

// Aeroacoustic whoosh: v^3 pressure, Strouhal vortex whistle, Doppler shift, and sweepPan.
export const createWhoosh = (
  source: WhooshSource,
  rate: number,
  length: number,
  pitchShift: number,
  vortexRand: () => number,
): ((i: number, outLR: Float64Array) => void) => {
  const engine: WhooshEngine = {
    source,
    rate,
    pitchShift,
    invLen: 1 / Math.max(1, length - 1),
    thickness: clamp(source.thickness ?? 0.4, 0.05, 4),
    dopplerAmt: clamp(source.doppler ?? 0.7, 0, 1),
    noiseTone: clamp(source.noiseTone ?? 0.5, 0, 1),
    uPeak: findPeakProgress(source.velocity),
    vortexBp1: createSvf('bandpass', rate),
    vortexBp2: createSvf('bandpass', rate),
    airLpL: createSvf('lowpass', rate),
    airLpR: createSvf('lowpass', rate),
    airHpL: createSvf('highpass', rate),
    airHpR: createSvf('highpass', rate),
    turbNode: {
      stepFrames: Math.max(48, Math.round(rate * 0.03)),
      frame: 0,
      prev: vortexRand(),
      next: vortexRand(),
    },
    vortexRand,
    vortexPhase: vortexRand() * TAU,
  };
  return (i: number, outLR: Float64Array): void => sampleWhooshFrame(engine, i, outLR);
};
