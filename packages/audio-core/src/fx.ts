import type { SoundVoice, VoiceDriveSpec, VoiceEqSpec, VoiceFxItem } from './contract';

interface BiquadCoeffs {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

type StereoFilter = (lr: Float64Array) => void;
type BufferFx = (buf: Float64Array, channels: 1 | 2) => void;
type FxOf<K extends VoiceFxItem['kind']> = Extract<VoiceFxItem, { readonly kind: K }>;

const TAU = Math.PI * 2;
const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

const createBiquad = (c: BiquadCoeffs): ((x: number) => number) => {
  const s = new Float64Array(4); // [x1, x2, y1, y2]
  return (x: number): number => {
    const y = c.b0 * x + c.b1 * s[0]! + c.b2 * s[1]! - c.a1 * s[2]! - c.a2 * s[3]!;
    s[1] = s[0]!;
    s[0] = x;
    s[3] = s[2]!;
    s[2] = y;
    return y;
  };
};

const createStereoBiquad = (c: BiquadCoeffs): StereoFilter => {
  const bL = createBiquad(c);
  const bR = createBiquad(c);
  return (lr) => {
    lr[0] = bL(lr[0]!);
    lr[1] = bR(lr[1]!);
  };
};

const shelfCoeffs = (kind: 'low' | 'high', hz: number, db: number, rate: number): BiquadCoeffs => {
  const amp = 10 ** (db / 40),
    w0 = (TAU * clamp(hz, 20, rate * 0.45)) / rate,
    cosW0 = Math.cos(w0);
  const beta = 2 * Math.sqrt(amp) * Math.sin(w0) * Math.SQRT1_2,
    s = kind === 'low' ? 1 : -1;
  const a0 = amp + 1 + s * (amp - 1) * cosW0 + beta;
  return {
    b0: (amp * (amp + 1 - s * (amp - 1) * cosW0 + beta)) / a0,
    b1: (s * 2 * amp * (amp - 1 - s * (amp + 1) * cosW0)) / a0,
    b2: (amp * (amp + 1 - s * (amp - 1) * cosW0 - beta)) / a0,
    a1: (-s * 2 * (amp - 1 + s * (amp + 1) * cosW0)) / a0,
    a2: (amp + 1 + s * (amp - 1) * cosW0 - beta) / a0,
  };
};

const peakCoeffs = (hz: number, db: number, q: number, rate: number): BiquadCoeffs => {
  const amp = 10 ** (db / 40),
    w0 = (TAU * clamp(hz, 20, rate * 0.45)) / rate;
  const cosW0 = Math.cos(w0),
    alpha = Math.sin(w0) / (2 * clamp(q, 0.1, 18)),
    a0 = 1 + alpha / amp;
  return {
    b0: (1 + alpha * amp) / a0,
    b1: (-2 * cosW0) / a0,
    b2: (1 - alpha * amp) / a0,
    a1: (-2 * cosW0) / a0,
    a2: (1 - alpha / amp) / a0,
  };
};

const buildEqChain = (eq: VoiceEqSpec | undefined, rate: number): StereoFilter[] => {
  if (!eq) return [];
  const bands: StereoFilter[] = [];
  if (eq.low && eq.low.db !== 0)
    bands.push(createStereoBiquad(shelfCoeffs('low', eq.low.hz, eq.low.db, rate)));
  if (eq.mid && eq.mid.db !== 0)
    bands.push(createStereoBiquad(peakCoeffs(eq.mid.hz, eq.mid.db, eq.mid.q ?? 1, rate)));
  if (eq.high && eq.high.db !== 0)
    bands.push(createStereoBiquad(shelfCoeffs('high', eq.high.hz, eq.high.db, rate)));
  return bands;
};

const createTapeDrive = (amount: number, rate: number): StereoFilter => {
  const g = 1 + amount;
  const norm = 1 / Math.tanh(g);
  const bias = 0.08 * clamp(amount * 0.25, 0, 1);
  const biasOut = Math.tanh(bias);
  const hfAlpha = 1 - Math.exp((-TAU * clamp(14000 - amount * 1200, 4500, 18000)) / rate);
  const lp = new Float64Array(2);
  return (lr) => {
    lp[0] = lp[0]! + hfAlpha * ((Math.tanh(g * lr[0]! + bias) - biasOut) * norm - lp[0]!);
    lp[1] = lp[1]! + hfAlpha * ((Math.tanh(g * lr[1]! + bias) - biasOut) * norm - lp[1]!);
    lr[0] = lp[0]!;
    lr[1] = lp[1]!;
  };
};

const createTubeDrive = (amount: number, rate: number): StereoFilter => {
  const g = 1 + amount * 0.9;
  const norm = 1 / Math.tanh(g);
  const dcAlpha = 1 - Math.exp((-TAU * 22) / rate);
  const dc = new Float64Array(2);
  return (lr) => {
    for (let ch = 0; ch < 2; ch += 1) {
      const y = Math.tanh(g * (lr[ch]! + 0.16 * lr[ch]! * lr[ch]!)) * norm;
      dc[ch] = dc[ch]! + dcAlpha * (y - dc[ch]!);
      lr[ch] = y - dc[ch]!;
    }
  };
};

const buildDrive = (drive: VoiceDriveSpec | undefined, rate: number): StereoFilter | null => {
  if (drive === undefined) return null;
  const amount = typeof drive === 'number' ? drive : drive.amount;
  if (amount <= 0) return null;
  const mode = typeof drive === 'number' ? 'tape' : drive.mode;
  if (mode === 'tube') return createTubeDrive(amount, rate);
  if (mode === 'grit') {
    const g = 1 + amount * 1.4;
    const norm = 1 / Math.atan(g);
    const shape = (x: number) => {
      const u = clamp(g * x, -1, 1);
      return 0.55 * Math.atan(g * x) * norm + 0.45 * (1.5 * u - 0.5 * u * u * u);
    };
    return (lr) => {
      lr[0] = shape(lr[0]!);
      lr[1] = shape(lr[1]!);
    };
  }
  if (mode === 'fold') {
    const g = 1 + amount * 0.85;
    const shape = (x: number) =>
      Math.tanh(0.8 * Math.sin(g * x * Math.PI * 0.5) + 0.25 * Math.tanh(g * x));
    return (lr) => {
      lr[0] = shape(lr[0]!);
      lr[1] = shape(lr[1]!);
    };
  }
  return createTapeDrive(amount, rate);
};

const readLinear = (buf: Float64Array, writeIdx: number, delaySamples: number): number => {
  const len = buf.length,
    pos = writeIdx - delaySamples,
    i0 = Math.floor(pos);
  const frac = pos - i0,
    idx0 = ((i0 % len) + len) % len;
  return buf[idx0]! * (1 - frac) + buf[(idx0 + 1) % len]! * frac;
};

const writeDryWet = (
  buf: Float64Array,
  channels: 1 | 2,
  frameIdx: number,
  dryL: number,
  dryR: number,
  wetL: number,
  wetR: number,
  dryGain: number,
  wetGain: number,
): void => {
  if (channels === 1) {
    buf[frameIdx] = dryGain * dryL + wetGain * 0.5 * (wetL + wetR);
    return;
  }
  buf[frameIdx * 2] = dryGain * dryL + wetGain * wetL;
  buf[frameIdx * 2 + 1] = dryGain * dryR + wetGain * wetR;
};

const readPair = (buf: Float64Array, channels: 1 | 2, i: number): readonly [number, number] => {
  const inL = buf[i * channels]!;
  return [inL, channels === 2 ? buf[i * 2 + 1]! : inL];
};

const CHORUS_PAN_L = [0.85, 0.5, 0.15];
const CHORUS_PAN_R = [0.15, 0.5, 0.85];

const createChorusFx = (item: FxOf<'chorus'>, rate: number): BufferFx => {
  const mix = clamp(item.mix, 0, 1);
  const depthSamp = (clamp(item.depth ?? 0.5, 0, 1) * 4.5 * rate) / 1000;
  const bases = [0.009 * rate, 0.014 * rate, 0.019 * rate];
  const bufLen = Math.ceil(0.03 * rate) + 4;
  const phaseInc = (TAU * clamp(item.rate ?? 0.65, 0.05, 8)) / rate;
  return (buf, channels) => {
    if (mix === 0) return;
    const ringL = new Float64Array(bufLen);
    const ringR = new Float64Array(bufLen);
    const frames = buf.length / channels;
    let writeIdx = 0;
    let phase = 0;
    for (let i = 0; i < frames; i += 1) {
      const [inL, inR] = readPair(buf, channels, i);
      ringL[writeIdx] = inL;
      ringR[writeIdx] = inR;
      let wetL = 0;
      let wetR = 0;
      for (let t = 0; t < 3; t += 1) {
        const mod = Math.sin(phase + (t * TAU) / 3) * depthSamp;
        wetL += readLinear(ringL, writeIdx, bases[t]! + mod) * CHORUS_PAN_L[t]!;
        wetR += readLinear(ringR, writeIdx, bases[t]! - mod) * CHORUS_PAN_R[t]!;
      }
      writeDryWet(buf, channels, i, inL, inR, wetL * 0.66, wetR * 0.66, 1 - mix, mix);
      writeIdx = (writeIdx + 1) % bufLen;
      phase = (phase + phaseInc) % TAU;
    }
  };
};

const stepAllPassChain = (
  state: Float64Array,
  input: number,
  lfoVal: number,
  rate: number,
): number => {
  const t = Math.tan((Math.PI * 260 * 12 ** (0.5 + 0.5 * lfoVal)) / rate);
  const coeff = (t - 1) / (t + 1);
  let x = input;
  for (let s = 0; s < state.length; s += 1) {
    const y = coeff * x + state[s]!;
    state[s] = x - coeff * y;
    x = y;
  }
  return x;
};

const createPhaserFx = (item: FxOf<'phaser'>, rate: number): BufferFx => {
  const mix = clamp(item.mix, 0, 1);
  const phaseInc = (TAU * clamp(item.rate ?? 0.45, 0.05, 8)) / rate;
  const stages = clamp(Math.round(item.stages ?? 4), 2, 8);
  return (buf, channels) => {
    if (mix === 0) return;
    const apL = new Float64Array(stages);
    const apR = new Float64Array(stages);
    const frames = buf.length / channels;
    let phase = 0;
    let fbL = 0;
    let fbR = 0;
    for (let i = 0; i < frames; i += 1) {
      const [inL, inR] = readPair(buf, channels, i);
      fbL = stepAllPassChain(apL, inL - 0.35 * fbL, Math.sin(phase), rate);
      fbR = stepAllPassChain(apR, inR - 0.35 * fbR, Math.cos(phase), rate);
      writeDryWet(buf, channels, i, inL, inR, fbL, fbR, 1 - mix, mix);
      phase = (phase + phaseInc) % TAU;
    }
  };
};

const runDelayLoop = (
  buf: Float64Array,
  channels: 1 | 2,
  mix: number,
  delaySamp: number,
  fb: number,
  dampAlpha: number,
  pingPong: boolean,
): void => {
  const lineL = new Float64Array(delaySamp);
  const lineR = new Float64Array(delaySamp);
  const frames = buf.length / channels;
  let idx = 0;
  let lpL = 0;
  let lpR = 0;
  for (let i = 0; i < frames; i += 1) {
    const [inL, inR] = readPair(buf, channels, i);
    const tapL = lineL[idx]!;
    const tapR = lineR[idx]!;
    lpL += dampAlpha * (tapL - lpL);
    lpR += dampAlpha * (tapR - lpR);
    lineL[idx] = pingPong ? inL + 0.5 * inR + lpR * fb : inL + lpL * fb;
    lineR[idx] = pingPong ? lpL * fb : inR + lpR * fb;
    writeDryWet(buf, channels, i, inL, inR, tapL, tapR, 1, mix);
    idx = (idx + 1) % delaySamp;
  }
};

const createDelayFx = (item: FxOf<'delay'>, rate: number): BufferFx => {
  const mix = clamp(item.mix, 0, 1);
  const delaySamp = Math.max(1, Math.round((clamp(item.timeMs, 1, 2000) * rate) / 1000));
  const fb = clamp(item.feedback ?? 0.35, 0, 0.92);
  const dampAlpha = 1 - Math.exp((-TAU * clamp(item.damping ?? 4800, 300, rate * 0.45)) / rate);
  const pingPong = item.pingPong ?? false;
  return (buf, channels) => {
    if (mix > 0) runDelayLoop(buf, channels, mix, delaySamp, fb, dampAlpha, pingPong);
  };
};

const readShifted = (buf: Float64Array, writeIdx: number, phase: number, win: number): number => {
  const pB = (phase + 0.5) % 1;
  return (
    (0.5 - 0.5 * Math.cos(TAU * phase)) * readLinear(buf, writeIdx, (1 - phase) * win + 2) +
    (0.5 - 0.5 * Math.cos(TAU * pB)) * readLinear(buf, writeIdx, (1 - pB) * win + 2)
  );
};

const createShimmerFx = (item: FxOf<'shimmer'>, rate: number): BufferFx => {
  const mix = clamp(item.mix, 0, 1);
  const fb = clamp(item.feedback ?? 0.45, 0, 0.85);
  const speed = 2 ** (clamp(item.shiftSemitones ?? 12, -24, 24) / 12);
  const win = Math.max(256, Math.round(0.042 * rate));
  const dampAlpha = 1 - Math.exp((-TAU * 6500) / rate);
  return (buf, channels) => {
    if (mix === 0) return;
    const shiftL = new Float64Array(win * 4),
      shiftR = new Float64Array(win * 4);
    const tankL = new Float64Array(Math.max(16, Math.round(0.065 * rate)));
    const tankR = new Float64Array(Math.max(16, Math.round(0.083 * rate)));
    const idx = new Int32Array(3),
      lp = new Float64Array(2);
    const frames = buf.length / channels,
      phaseInc = (speed - 1) / win;
    let grainPhase = 0;
    for (let i = 0; i < frames; i += 1) {
      const [inL, inR] = readPair(buf, channels, i);
      const tL = tankL[idx[1]!]!,
        tR = tankR[idx[2]!]!;
      lp[0] = lp[0]! + dampAlpha * (tL - lp[0]!);
      lp[1] = lp[1]! + dampAlpha * (tR - lp[1]!);
      shiftL[idx[0]!] = inL + lp[1]! * fb;
      shiftR[idx[0]!] = inR + lp[0]! * fb;
      tankL[idx[1]!] = readShifted(shiftL, idx[0]!, grainPhase, win);
      tankR[idx[2]!] = readShifted(shiftR, idx[0]!, grainPhase, win);
      writeDryWet(buf, channels, i, inL, inR, tL, tR, 1, mix);
      idx[0] = (idx[0]! + 1) % shiftL.length;
      idx[1] = (idx[1]! + 1) % tankL.length;
      idx[2] = (idx[2]! + 1) % tankR.length;
      grainPhase = (grainPhase + phaseInc + 1) % 1;
    }
  };
};

const buildFxNode = (item: VoiceFxItem, rate: number): BufferFx => {
  if (item.kind === 'chorus') return createChorusFx(item, rate);
  if (item.kind === 'phaser') return createPhaserFx(item, rate);
  if (item.kind === 'delay') return createDelayFx(item, rate);
  return createShimmerFx(item, rate);
};

const applyFrameStageToBuffer = (
  buf: Float64Array,
  channels: 1 | 2,
  applyEqAndDrive: (lr: Float64Array) => void,
): void => {
  const lr = new Float64Array(2);
  const frames = buf.length / channels;
  for (let i = 0; i < frames; i += 1) {
    [lr[0], lr[1]] = readPair(buf, channels, i);
    applyEqAndDrive(lr);
    writeDryWet(buf, channels, i, 0, 0, lr[0]!, lr[1]!, 0, 1);
  }
};

export interface VoiceFxRack {
  readonly applyEqAndDrive: (lr: Float64Array) => void;
  readonly applyStereoFx: (buf: Float64Array, channels: 1 | 2) => void;
  readonly applyAll: (buf: Float64Array, channels: 1 | 2) => void;
}

/** Creates a deterministic per-voice Studio FX Rack: 3-band EQ, character drive, and stereo FX chain. */
export const createVoiceFxRack = (
  voice: Pick<SoundVoice, 'eq' | 'drive' | 'fx'>,
  rate: number,
): VoiceFxRack => {
  const eqBands = buildEqChain(voice.eq, rate);
  const driveStage = buildDrive(voice.drive, rate);
  const fxChain = (voice.fx ?? []).map((item) => buildFxNode(item, rate));
  const applyEqAndDrive = (lr: Float64Array): void => {
    for (let b = 0; b < eqBands.length; b += 1) eqBands[b]!(lr);
    if (driveStage) driveStage(lr);
  };
  const applyStereoFx = (buf: Float64Array, channels: 1 | 2): void => {
    for (let f = 0; f < fxChain.length; f += 1) fxChain[f]!(buf, channels);
  };
  const applyAll = (buf: Float64Array, channels: 1 | 2): void => {
    if (eqBands.length > 0 || driveStage !== null)
      applyFrameStageToBuffer(buf, channels, applyEqAndDrive);
    applyStereoFx(buf, channels);
  };
  return { applyEqAndDrive, applyStereoFx, applyAll };
};
