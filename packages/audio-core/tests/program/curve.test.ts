import assert from 'node:assert/strict';
import { parseSoundSource, readRecipe, type Control, type Curve } from '../../src';
import { evaluate } from '../../src/curve';
import { fixture } from './fixture';
const c: Curve = {
  domain: 'log',
  interpolation: 'linear',
  points: [
    { at: 0, value: 100 },
    { at: 1, value: 400 },
  ],
};
assert.equal(evaluate(c, 0), 100);
assert.equal(evaluate(c, 1), 400);
assert.ok(Math.abs(evaluate(c, 0.5) - 200) < 1e-10);
const smooth: Curve = { ...c, domain: 'linear', interpolation: 'smooth' };
assert.ok((evaluate(smooth, 0.000001) - 100) / 0.000001 < 0.001);
for (let i = 0; i <= 100; i++)
  assert.ok(evaluate(smooth, i / 100) >= 100 && evaluate(smooth, i / 100) <= 400);
const r = fixture(),
  voice = r.voices[0];
for (const points of [
  [
    { at: 0, value: 0 },
    { at: 1, value: 1 },
  ],
  [
    { at: 0, value: 100 },
    { at: 0, value: 200 },
  ],
])
  assert.throws(() => readRecipe({ ...r, voices: [{ ...voice, lowpass: { ...c, points } }] }));
assert.throws(
  () => readRecipe({ ...r, voices: [{ ...voice, highpass: 500, lowpass: c }] }),
  /separate the entire/,
);
assert.throws(
  () =>
    readRecipe({
      ...r,
      voices: [
        {
          ...voice,
          gain: {
            ...smooth,
            points: [
              { at: 0, value: 0 },
              { at: 0.001, value: 1 },
              { at: 1, value: 0 },
            ],
          },
        },
      ],
    }),
  /96 frames/,
);
assert.throws(() => readRecipe({ ...r, voices: [{ ...voice, gain: 1 }] }), /zero endpoint/);
assert.throws(
  () => readRecipe({ ...r, voices: [{ ...voice, gain: { ...smooth, domain: 'log' } }] }),
  /domain/,
);

// Segment-specific transition easings preserve distinct authored shapes.
const eased = (expr: string): Control =>
  parseSoundSource(
    `ashfox 1 sound e { profile = ui; duration = 0.5s; seed = 1; voice v : noise { color = white; pan = ${expr}; gain = 0 -> 0.8 -> 0; } seq s { step a { voice = v; at = 0s; duration = 0.4s; } } master { peak = -3db; } }`,
  ).voices[0]!.pan!;
const easeIn = eased('0 ease_in -> 1');
const easeOut = eased('0 ease_out -> 1');
const snapCurve = eased('0 snap -> 1');
const mixedCurve = eased('0: -1 ease_in -> 0.5: 0 linear -> 1: 1');
assert.ok(evaluate(easeIn, 0.25) < 0.1 && evaluate(easeOut, 0.25) > 0.4);
assert.equal(evaluate(snapCurve, 0.75), 0);
assert.equal(evaluate(snapCurve, 1), 1);
assert.ok(Math.abs(evaluate(mixedCurve, 0.25) - -0.75) < 1e-10);
assert.ok(Math.abs(evaluate(mixedCurve, 0.75) - 0.5) < 1e-10);

process.stdout.write(
  'curve: endpoint/midpoint, smooth slopes, per-segment easings, positive log, no overshoot, cutoff invariant and shortest resolution passed\n',
);
