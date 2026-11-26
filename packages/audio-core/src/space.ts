import type { SpaceSpec } from './contract';

const BASE_DELAYS = [149, 211, 263, 331] as const;

/** Deterministic 4-line Hadamard Feedback Delay Network for subtle room / tail space. */
export const applySpace = (
  pcm: Float64Array,
  channels: 1 | 2,
  rate: number,
  space: SpaceSpec | undefined,
): Float64Array => {
  if (!space || space.mix === 0) return pcm;
  const frames = pcm.length / channels;
  const delays = BASE_DELAYS.map((d) => Math.max(32, Math.round(d * space.size * (rate / 48000))));
  const lines = delays.map((len) => new Float64Array(len));
  const indices = [0, 0, 0, 0];
  const lp = [0, 0, 0, 0];
  const damp = 1 - Math.exp((-2 * Math.PI * space.damping) / rate);
  const gains = delays.map((len) => 10 ** ((-3 * len) / (space.decay * rate)));
  const out = new Float64Array(pcm.length);
  const wet = space.mix;
  const dry = 1 - wet * 0.4;
  for (let i = 0; i < frames; i += 1) {
    const lIn = pcm[i * channels]!;
    const rIn = channels === 2 ? pcm[i * channels + 1]! : lIn;
    const mono = (lIn + rIn) * 0.5;
    const y0 = lines[0]![indices[0]!]!;
    const y1 = lines[1]![indices[1]!]!;
    const y2 = lines[2]![indices[2]!]!;
    const y3 = lines[3]![indices[3]!]!;
    const h0 = 0.5 * (y0 + y1 + y2 + y3);
    const h1 = 0.5 * (y0 - y1 + y2 - y3);
    const h2 = 0.5 * (y0 + y1 - y2 - y3);
    const h3 = 0.5 * (y0 - y1 - y2 + y3);
    const mixed = [h0, h1, h2, h3];
    for (let k = 0; k < 4; k += 1) {
      lp[k] = lp[k]! + damp * (mixed[k]! * gains[k]! - lp[k]!);
      lines[k]![indices[k]!] = mono + lp[k]!;
      indices[k] = (indices[k]! + 1) % delays[k]!;
    }
    const wetL = 0.35 * (y0 + y1 - y2 + y3);
    const wetR = 0.35 * (y0 - y1 + y2 - y3);
    if (channels === 1) {
      out[i] = dry * lIn + wet * (wetL + wetR) * 0.5;
    } else {
      out[i * 2] = dry * lIn + wet * wetL;
      out[i * 2 + 1] = dry * rIn + wet * wetR;
    }
  }
  return out;
};
