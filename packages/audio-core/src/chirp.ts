import type { ChirpSource } from './contract';
import { evaluate } from './curve';

const TAU = Math.PI * 2;
const smooth = (value: number) => value * value * (3 - 2 * value);

// Continuous phase and log-pitch curves join syllable bends without pitch steps.
// Seeded detune, slow jitter and turbulent air vary each rendition reproducibly.
export const createChirp = (source: ChirpSource, rate: number, pitchShift: number, random: () => number, breath: () => number, trillRandom: () => number) => {
  let phase = 0, jitterFrom = random(), jitterTo = random();
  let jitterFrame = 0, air = 0;
  const trillPhase = trillRandom() * .25;
  const jitterPeriod = Math.round(rate * .018);
  return (time: number, progress: number) => {
    const pitch = evaluate(source.pitch, progress) * pitchShift;
    if (jitterFrame >= jitterPeriod) { jitterFrom = jitterTo; jitterTo = random(); jitterFrame = 0; }
    const jitter = jitterFrom + (jitterTo - jitterFrom) * smooth(jitterFrame++ / jitterPeriod);
    const trill = source.trillHz === 0 ? 0 : Math.sin(TAU * source.trillHz * time + trillPhase);
    const frequency = pitch * Math.pow(2, (jitter * source.jitterCents * .35 + trill * source.trillCents) / 1200);
    phase = (phase + TAU * frequency / rate) % TAU;
    let tone = Math.sin(phase);
    for (let harmonic = 2; harmonic <= 3; harmonic++) {
      // Fade partials before Nyquist, including pitch modulation excursions.
      const band = Math.max(0, Math.min(1, (rate * .48 - frequency * harmonic) / (rate * .06)));
      tone += Math.sin(phase * harmonic) * evaluate(source.brightness, progress) * (harmonic === 2 ? .22 : .055) * band;
    }
    const turbulence = source.breath === 0 ? 0 : breath();
    air += .32 * (turbulence - air);
    const articulation = source.trillHz === 0 ? 1 : 1 - source.trillDepth * (.5 - .5 * trill);
    return (tone + (turbulence - air) * source.breath) * articulation;
  };
};
