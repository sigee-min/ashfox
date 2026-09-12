import type { ChirpSource } from './contract';

const TAU = Math.PI * 2;
const smooth = (value: number) => value * value * (3 - 2 * value);

// Continuous phase and log-pitch curves join syllable bends without pitch steps.
// Seeded detune, slow jitter and turbulent air vary each rendition reproducibly.
export const createChirp = (source: ChirpSource, rate: number, duration: number, random: () => number) => {
  let phase = 0, segment = 0, jitterFrom = random(), jitterTo = random();
  let jitterFrame = 0, air = 0;
  const detune = random() * source.jitterCents;
  const trillPhase = random() * .25;
  const jitterPeriod = Math.round(rate * .018);
  return (time: number) => {
    const progress = Math.min(1, time / duration);
    while (segment < source.contour.length - 2 && progress > source.contour[segment + 1].at) segment++;
    const from = source.contour[segment], to = source.contour[segment + 1];
    const bend = smooth(Math.max(0, Math.min(1, (progress - from.at) / (to.at - from.at))));
    const pitch = from.hz * Math.pow(to.hz / from.hz, bend);
    if (jitterFrame >= jitterPeriod) { jitterFrom = jitterTo; jitterTo = random(); jitterFrame = 0; }
    const jitter = jitterFrom + (jitterTo - jitterFrom) * smooth(jitterFrame++ / jitterPeriod);
    const trill = source.trillHz === 0 ? 0 : Math.sin(TAU * source.trillHz * time + trillPhase);
    const frequency = pitch * Math.pow(2, (detune + jitter * source.jitterCents * .35 + trill * source.trillCents) / 1200);
    phase = (phase + TAU * frequency / rate) % TAU;
    let tone = Math.sin(phase);
    for (let harmonic = 2; harmonic <= 3; harmonic++) {
      // Fade partials before Nyquist, including pitch modulation excursions.
      const band = Math.max(0, Math.min(1, (rate * .48 - frequency * harmonic) / (rate * .06)));
      tone += Math.sin(phase * harmonic) * source.brightness * (harmonic === 2 ? .22 : .055) * band;
    }
    const turbulence = random();
    air += .32 * (turbulence - air);
    const articulation = source.trillHz === 0 ? 1 : 1 - source.trillDepth * (.5 - .5 * trill);
    return (tone + (turbulence - air) * source.breath) * articulation;
  };
};
