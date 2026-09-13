import type { VocalSource } from './contract';
import { evaluate } from './curve';

// Pulse excitation, turbulent breath and three resonances; no sampled material.
export const createVoice = (source: VocalSource, rate: number, pitchShift: number, random: () => number, breath: () => number) => {
  let phase = 0, cycle = 0, detune = 1, strength = 1, prior = 0, prior2 = 0;
  const resonators = source.formants.map((hz, i) => {
    const radius = Math.exp(-Math.PI * source.bandwidths[i] / rate);
    return { a: 2 * radius * Math.cos(2 * Math.PI * hz / rate), b: radius * radius, gain: 1 - radius, y1: 0, y2: 0 };
  });
  return (progress: number) => {
    const frequency = evaluate(source.pitch, progress) * pitchShift;
    phase += frequency * detune / rate;
    if (phase >= 1) {
      phase -= 1; cycle++;
      detune = Math.pow(2, random() * source.jitter * .1);
      strength = 1 - source.roughness * (.5 + .5 * Math.sin(cycle * 2.399963));
    }
    const pulse = phase < .45 ? .5 * (1 - Math.cos(Math.PI * phase / .45)) :
      phase < .65 ? Math.cos(Math.PI / 2 * (phase - .45) / .2) : 0;
    const excitation = pulse * strength + (source.breath === 0 ? 0 : breath()) * source.breath * (.2 + pulse * .8);
    let result = 0;
    for (const [i, r] of resonators.entries()) {
      const y = r.gain * (excitation - prior2) + r.a * r.y1 - r.b * r.y2;
      r.y2 = r.y1; r.y1 = y; result += y / (1 + i * .6);
    }
    prior2 = prior; prior = excitation;
    return result;
  };
};
