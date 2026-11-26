import type { WaveguideSource } from './contract';
import { evaluate } from './curve';
import { createSvf } from './filter';

const BUF_SIZE = 8192;
const BUF_MASK = BUF_SIZE - 1;
const TAU = Math.PI * 2;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

interface DelayLoop {
  readonly buf: Float64Array;
  writeIdx: number;
  lp: number;
  apX: number;
  apY: number;
  dcX: number;
  dcY: number;
}

const createLoop = (): DelayLoop => ({
  buf: new Float64Array(BUF_SIZE),
  writeIdx: 0,
  lp: 0,
  apX: 0,
  apY: 0,
  dcX: 0,
  dcY: 0,
});

/** 4-point cubic Lagrange interpolation for smooth fractional pitch sweeps. */
const readFractional = (buf: Float64Array, writeIdx: number, delaySamples: number): number => {
  const clamped = clamp(delaySamples, 2, BUF_SIZE - 4);
  const d0 = Math.floor(clamped);
  const f = clamped - d0;
  const x0 = buf[(writeIdx - d0 + 1) & BUF_MASK]!;
  const x1 = buf[(writeIdx - d0) & BUF_MASK]!;
  const x2 = buf[(writeIdx - d0 - 1) & BUF_MASK]!;
  const x3 = buf[(writeIdx - d0 - 2) & BUF_MASK]!;
  const c0 = x1;
  const c1 = -x0 / 3 - 0.5 * x1 + x2 - x3 / 6;
  const c2 = 0.5 * x0 - x1 + 0.5 * x2;
  const c3 = -x0 / 6 + 0.5 * x1 - 0.5 * x2 + x3 / 6;
  return ((c3 * f + c2) * f + c1) * f + c0;
};

const stepDispersion = (loop: DelayLoop, x: number, coeff: number): number => {
  const y = coeff * (x - loop.apY) + loop.apX;
  loop.apX = x;
  loop.apY = y;
  return y;
};

const stepDcBlock = (loop: DelayLoop, x: number): number => {
  const y = x - loop.dcX + 0.996 * loop.dcY;
  loop.dcX = x;
  loop.dcY = y;
  return y;
};

const writeLoop = (loop: DelayLoop, value: number): void => {
  loop.buf[loop.writeIdx] = value;
  loop.writeIdx = (loop.writeIdx + 1) & BUF_MASK;
};

const createStringSampler = (
  source: WaveguideSource,
  rate: number,
  length: number,
  pitchShift: number,
  exRand: () => number,
): ((i: number, outLR: Float64Array) => void) => {
  const loop = createLoop();
  const damping = clamp(source.damping ?? 0.25, 0, 1);
  const stiffness = clamp(source.stiffness ?? 0.2, 0, 1);
  const brightness = clamp(source.brightness ?? 0.65, 0, 1);
  const apCoeff = stiffness * 0.52;
  const lpAlpha = 0.18 + 0.72 * brightness;
  const fbGain = 0.9965 - damping * 0.032;
  const burstFrames = Math.max(12, Math.round(rate * 0.0035));
  const invLen = 1 / Math.max(1, length - 1);
  let excLp = 0;

  return (i: number, outLR: Float64Array): void => {
    const hz = clamp(evaluate(source.pitch, i * invLen) * pitchShift, 20, rate * 0.35);
    const delay = rate / hz - 0.5;
    let exc = 0;
    if (i < burstFrames) {
      const win = Math.sin((Math.PI * (i + 0.5)) / burstFrames);
      const raw = exRand() * 2 - 1;
      excLp += (0.2 + 0.75 * brightness) * (raw - excLp);
      exc = excLp * win * 0.95;
    }
    const main = readFractional(loop.buf, loop.writeIdx, delay);
    const bridge = readFractional(loop.buf, loop.writeIdx, Math.max(2, delay * 0.18));
    const disp = stepDispersion(loop, main, apCoeff);
    loop.lp += lpAlpha * (disp - loop.lp);
    const next = stepDcBlock(loop, Math.tanh((exc + loop.lp * fbGain) * 1.05));
    writeLoop(loop, next);
    const body = main - 0.35 * bridge;
    outLR[0] = body * 0.85 + main * 0.2;
    outLR[1] = body * 0.85 + bridge * 0.35;
  };
};

const createBladeSampler = (
  source: WaveguideSource,
  rate: number,
  length: number,
  pitchShift: number,
  exRand: () => number,
): ((i: number, outLR: Float64Array) => void) => {
  const loopA = createLoop();
  const loopB = createLoop();
  const damping = clamp(source.damping ?? 0.18, 0, 1);
  const stiffness = clamp(source.stiffness ?? 0.65, 0, 1);
  const brightness = clamp(source.brightness ?? 0.75, 0, 1);
  const apA = 0.25 + stiffness * 0.42;
  const apB = 0.32 + stiffness * 0.48;
  const lpAlpha = 0.28 + 0.65 * brightness;
  const fbGain = 0.997 - damping * 0.028;
  const burstFrames = Math.max(8, Math.round(rate * 0.0025));
  const invLen = 1 / Math.max(1, length - 1);

  return (i: number, outLR: Float64Array): void => {
    const hz = clamp(evaluate(source.pitch, i * invLen) * pitchShift, 30, rate * 0.32);
    const delayA = rate / hz;
    const delayB = rate / (hz * (1.41 + 0.32 * stiffness));
    const exc =
      i < burstFrames ? (exRand() * 2 - 1) * (1 - i / burstFrames) * (0.7 + 0.3 * brightness) : 0;

    const aOut = readFractional(loopA.buf, loopA.writeIdx, delayA);
    const bOut = readFractional(loopB.buf, loopB.writeIdx, delayB);
    const dispA = stepDispersion(loopA, aOut + 0.18 * bOut, apA);
    const dispB = stepDispersion(loopB, bOut - 0.18 * aOut, apB);
    loopA.lp += lpAlpha * (dispA - loopA.lp);
    loopB.lp += lpAlpha * (dispB - loopB.lp);

    writeLoop(loopA, stepDcBlock(loopA, Math.tanh(exc + loopA.lp * fbGain)));
    writeLoop(loopB, stepDcBlock(loopB, Math.tanh(exc * 0.75 + loopB.lp * fbGain)));
    outLR[0] = aOut * 0.75 + bOut * 0.35;
    outLR[1] = bOut * 0.65 + aOut * 0.45;
  };
};

const createCreakSampler = (
  source: WaveguideSource,
  rate: number,
  length: number,
  pitchShift: number,
  exRand: () => number,
): ((i: number, outLR: Float64Array) => void) => {
  const loop = createLoop();
  const damping = clamp(source.damping ?? 0.32, 0, 1);
  const bowPressure = clamp(source.bowPressure ?? 0.6, 0.05, 1);
  const brightness = clamp(source.brightness ?? 0.55, 0, 1);
  const stiffness = clamp(source.stiffness ?? 0.35, 0, 1);
  const woodBody = createSvf('bandpass', rate);
  const woodMid = createSvf('bandpass', rate);
  const fbGain = 0.96 - damping * 0.1;
  const lpAlpha = 0.16 + 0.55 * brightness;
  const apCoeff = stiffness * 0.4;
  const invLen = 1 / Math.max(1, length - 1);
  let bowModPhase = exRand() * TAU;
  let bowJitter = 0;

  return (i: number, outLR: Float64Array): void => {
    const u = i * invLen;
    const hz = clamp(evaluate(source.pitch, u) * pitchShift, 25, rate * 0.28);
    const delay = rate / hz;
    bowModPhase = (bowModPhase + (TAU * (3.2 + 5.5 * bowPressure)) / rate) % TAU;
    bowJitter += 0.02 * (exRand() * 2 - 1 - bowJitter);
    const vBow =
      (0.28 + 0.45 * bowPressure) * (0.72 + 0.28 * Math.sin(bowModPhase) + 0.25 * bowJitter);

    const waveOut = readFractional(loop.buf, loop.writeIdx, delay);
    const dv = vBow - waveOut;
    const mu = 0.25 + 0.7 * Math.exp(-Math.abs(dv) / (0.14 + 0.18 * (1 - bowPressure)));
    const friction = Math.tanh(dv * (5 + 6 * bowPressure)) * mu * bowPressure * 0.55;
    const disp = stepDispersion(loop, waveOut, apCoeff);
    loop.lp += lpAlpha * (disp - loop.lp);
    const next = stepDcBlock(loop, Math.tanh(loop.lp * fbGain + friction));
    writeLoop(loop, next);

    const bodyLow = woodBody(next, clamp(hz * 2.2, 180, 900), 2.4);
    const bodyHi = woodMid(next, clamp(750 + 1100 * brightness, 400, 3200), 3.1);
    outLR[0] = next * 0.45 + bodyLow * 0.75 + bodyHi * 0.35;
    outLR[1] = next * 0.45 + bodyLow * 0.65 + bodyHi * 0.52;
  };
};

const createPipeSampler = (
  source: WaveguideSource,
  rate: number,
  length: number,
  pitchShift: number,
  exRand: () => number,
): ((i: number, outLR: Float64Array) => void) => {
  const loop = createLoop();
  const damping = clamp(source.damping ?? 0.22, 0, 1);
  const bowPressure = clamp(source.bowPressure ?? 0.6, 0.1, 1);
  const brightness = clamp(source.brightness ?? 0.6, 0, 1);
  const jetLoop = createLoop();
  const breathBp = createSvf('bandpass', rate);
  const lpAlpha = 0.22 + 0.68 * brightness;
  const fbGain = 0.985 - damping * 0.05;
  const invLen = 1 / Math.max(1, length - 1);

  return (i: number, outLR: Float64Array): void => {
    const u = i * invLen;
    const hz = clamp(evaluate(source.pitch, u) * pitchShift, 40, rate * 0.32);
    const delay = rate / (2 * hz);
    const jetDelay = Math.max(2, delay * 0.45);
    const attack = Math.min(1, i / Math.max(1, Math.round(rate * 0.025)));
    const breathNoise = breathBp(exRand() * 2 - 1, clamp(hz * 2.4, 300, 5000), 1.4);
    const boreOut = readFractional(loop.buf, loop.writeIdx, delay);

    const jetIn =
      (bowPressure * 0.42 + breathNoise * (0.14 + 0.12 * brightness)) * attack - 0.85 * boreOut;
    writeLoop(jetLoop, jetIn);
    const jetDelayed = readFractional(jetLoop.buf, jetLoop.writeIdx, jetDelay);
    const jetForce = Math.tanh(jetDelayed * 2.4) - 0.12 * jetDelayed * jetDelayed * jetDelayed;

    const reflected = -boreOut * fbGain + jetForce * 0.34;
    loop.lp += lpAlpha * (reflected - loop.lp);
    const next = stepDcBlock(loop, Math.tanh(loop.lp));
    writeLoop(loop, next);

    const mouth = jetForce * 0.32 + breathNoise * 0.08 * attack;
    outLR[0] = boreOut * 0.72 + mouth * 0.65;
    outLR[1] = -next * 0.72 + mouth * 0.45;
  };
};

// Fractional-delay dispersive waveguide synthesis for string, blade, creak, and pipe models.
export const createWaveguide = (
  source: WaveguideSource,
  rate: number,
  length: number,
  pitchShift: number,
  exRand: () => number,
): ((i: number, outLR: Float64Array) => void) => {
  if (source.model === 'blade') return createBladeSampler(source, rate, length, pitchShift, exRand);
  if (source.model === 'creak') return createCreakSampler(source, rate, length, pitchShift, exRand);
  if (source.model === 'pipe') return createPipeSampler(source, rate, length, pitchShift, exRand);
  return createStringSampler(source, rate, length, pitchShift, exRand);
};
