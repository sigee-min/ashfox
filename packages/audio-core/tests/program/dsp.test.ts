import assert from 'node:assert/strict';
import { compileSoundSource, parseSoundSource, readRecipe } from '../../src';

// Verify audio DSP chain: SVF filter, PolyBLEP unison osc, granular ember, mallet resonator, drive, space, stereo pan, envelope shorthand, and mastering limiter.
const stereoMagic = `ashfox 1
sound magic_cast {
  profile = magic;
  duration = 0.8s;
  channels = 2;
  seed = 77;
  space { preset = ethereal; mix = 25%; decay = 0.35s; damping = 6500hz; size = 0.9; }
  voice shimmer : osc {
    waveform = saw;
    pitch { domain = log; interpolation = smooth; points = [(0, 320hz), (0.4, 640hz), (1, 480hz)]; }
    unison = 3;
    detune_cents = 18cents;
    filter bandpass { cutoff = 500hz -> 4200hz; q = 2.4; }
    drive = 2.5;
    pan = -0.35;
    gain { env = adsr; attack = 30ms; decay = 0.15s; sustain = 55%; release = 0.25s; peak = 0.9; curve = exp; }
  }
  voice sparks : granular {
    texture = ember;
    density = 120;
    filter highpass { cutoff = 1800hz; q = 1.2; }
    pan = 0.45;
    gain { env = ad; attack = 20ms; peak = 0.6; curve = linear; }
  }
  seq cast {
    start = 20ms;
    step pad { voice = shimmer; at = 0s; duration = 0.7s; vary_pitch = -15cents..15cents; }
    step dust { voice = sparks; at = 50ms; duration = 0.6s; }
  }
  variant base { seed = 101; }
  variant alt { seed = 102; }
  master { gain = -3db; peak = -1db; punch = 20%; warmth = 15%; air = 25%; glue = 25%; width = 1.15; limit = true; }
}`;

const parsed = parseSoundSource(stereoMagic, 'magic_cast.ashfox');
assert.equal(parsed.channels, 2);
const products = compileSoundSource(stereoMagic, 'magic_cast.ashfox');
assert.equal(products.length, 2);
for (const p of products) {
  assert.equal(p.channels, 2);
  assert.equal(p.profile, 'magic');
  assert.equal(Buffer.from(p.wav).readUInt16LE(22), 2);
  assert.equal(p.wav.length, 44 + p.frames * 4);
  assert.ok(p.peak <= 10 ** (-1 / 20) + 1e-4);
}
assert.notDeepEqual(products[0]!.wav, products[1]!.wav);

// Stereo pan rejected when channels = 1.
assert.throws(() => readRecipe({ ...parsed, channels: 1 }), /pan requires channels = 2/);

// Mallet resonator + pitch_drop compiles cleanly.
const wood = `ashfox 1
sound wood_tap {
  profile = foley;
  duration = 0.35s;
  seed = 9;
  voice body : resonator {
    excitation mallet { duration = 8ms; hardness = 60%; }
    mode m1 { hz = 240hz; decay = 0.14s; gain = 1; }
    mode m2 { hz = 590hz; decay = 80ms; gain = 0.4; }
    pitch_drop_cents = 120cents;
    pitch_drop_seconds = 25ms;
    gain { env = ad; attack = 4ms; peak = 0.9; }
    highpass = 45hz;
  }
  seq tap { start = 0s; step hit { voice = body; at = 0s; duration = 0.3s; } }
  variant base { seed = 1; }
  master { gain = 0db; peak = -2db; punch = 30%; limit = true; }
}`;
const tapProducts = compileSoundSource(wood, 'wood_tap.ashfox');
assert.equal(tapProducts[0]!.channels, 1);
assert.ok(tapProducts[0]!.rms > 0.01);

process.stdout.write(
  'dsp 2.0: SVF, PolyBLEP unison osc, granular ember, mallet pitchDrop, drive, space, stereo, master & envelopes ok\n',
);
