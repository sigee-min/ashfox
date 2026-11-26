import assert from 'node:assert/strict';
import type { EnvelopeControl } from '../../src';
import { evaluateGain, gainBounds } from '../../src/envelope';

const RATE = 48000;
const FRAMES = 48001; // exact 1.000s span (0..48000)

// 1. AD envelope: exact 0 endpoints, peak at attack end, true exp steeper than linear and c*c.
const adExp: EnvelopeControl = { env: 'ad', attack: 0.1, peak: 0.8, curve: 'exp' };
const adLin: EnvelopeControl = { env: 'ad', attack: 0.1, peak: 0.8, curve: 'linear' };

assert.equal(evaluateGain(adExp, 0, FRAMES, RATE), 0);
assert.equal(evaluateGain(adExp, FRAMES - 1, FRAMES, RATE), 0);
assert.equal(evaluateGain(adExp, 4800, FRAMES, RATE), 0.8);
assert.equal(evaluateGain(adLin, 4800, FRAMES, RATE), 0.8);

for (const frac of [0.2, 0.4, 0.6, 0.8]) {
  const frameIdx = Math.round((0.1 + 0.9 * frac) * RATE);
  const rem = 1 - frac;
  const expVal = evaluateGain(adExp, frameIdx, FRAMES, RATE);
  const linVal = evaluateGain(adLin, frameIdx, FRAMES, RATE);
  const legacySquareVal = 0.8 * rem * rem;
  assert.ok(
    expVal < linVal,
    `exp (${expVal}) should be steeper than linear (${linVal}) at frac=${frac}`,
  );
  assert.ok(
    expVal < legacySquareVal - 0.01,
    `true exp (${expVal}) should differ cleanly below legacy c*c (${legacySquareVal}) at frac=${frac}`,
  );
}

// 2. ADSR envelope: endpoints, peak, sustain plateau, and exp decay/release.
const adsrExp: EnvelopeControl = {
  env: 'adsr',
  attack: 0.1,
  decay: 0.2,
  sustain: 0.5,
  release: 0.2,
  peak: 1.2,
  curve: 'exp',
};
const adsrLin: EnvelopeControl = { ...adsrExp, curve: 'linear' };

assert.equal(evaluateGain(adsrExp, 0, FRAMES, RATE), 0);
assert.equal(evaluateGain(adsrExp, FRAMES - 1, FRAMES, RATE), 0);
assert.equal(evaluateGain(adsrExp, 4800, FRAMES, RATE), 1.2);
assert.ok(Math.abs(evaluateGain(adsrExp, 24000, FRAMES, RATE) - 0.6) < 1e-12);

const decayMid = Math.round(0.2 * RATE);
assert.ok(
  evaluateGain(adsrExp, decayMid, FRAMES, RATE) < evaluateGain(adsrLin, decayMid, FRAMES, RATE),
);
const releaseMid = Math.round(0.9 * RATE);
assert.ok(
  evaluateGain(adsrExp, releaseMid, FRAMES, RATE) < evaluateGain(adsrLin, releaseMid, FRAMES, RATE),
);

// 3. gainBounds handles envelopes and curves.
assert.deepEqual(gainBounds(adExp), [0, 0.8]);
assert.deepEqual(gainBounds({ env: 'ad', attack: 0.05 }), [0, 1]);
assert.deepEqual(
  gainBounds({
    domain: 'linear',
    interpolation: 'linear',
    points: [
      { at: 0, value: 0 },
      { at: 0.5, value: 1.5 },
      { at: 1, value: 0 },
    ],
  }),
  [0, 1.5],
);

process.stdout.write(
  'envelope: exact endpoints/peak, true exp steepness vs linear and c*c, and ADSR bounds passed\n',
);
