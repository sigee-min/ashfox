import assert from 'node:assert/strict';
import { compileSoundSource, parseSoundSource, readRecipe } from '../../src';

// Verify audio DSP chain: SVF filter, PolyBLEP unison osc, granular, waveguide, whoosh, fx rack, duck, drift, space, and mastering limiter.
const stereoMagic = `ashfox 1
sound magic_cast {
  profile = magic;
  duration = 0.8s;
  sample_rate = 48000hz;
  channels = 2;
  seed = 77;
  space { preset = ethereal; mix = 25%; decay = 350ms; damping = 6500hz; size = 0.9; }

  voice shimmer : osc {
    waveform = saw;
    pitch = log(0: 320hz -> 0.4: 640hz -> 1: 480hz);
    unison = 3;
    detune_cents = 18cents;
    filter : bandpass { cutoff = log(0: 500hz -> 1: 4200hz); q = 2.4; }
    eq { low = (140hz, 2db); high = (5500hz, 1.5db); }
    drive : fold { amount = 2.2; }
    fx : chorus { mix = 22%; rate = 1.6hz; depth = 35%; }
    fx : shimmer { mix = 20%; feedback = 25%; shift_semitones = 12st; }
    pan = -0.4 -> 0.35;
    gain { env = adsr; attack = 30ms; decay = 150ms; sustain = 0.55; release = 250ms; peak = 0.9; curve = exp; }
  }

  voice sparks : granular {
    texture = ember;
    density = 120;
    stereo_width = 0.85;
    itd_ms = 0.3ms;
    filter : highpass { cutoff = 1800hz; q = 1.2; }
    duck { by = shimmer; amount = 35%; release_ms = 70ms; }
    drift { target = pan; depth = 30%; rate = 1.5hz; }
    pan = 0.45;
    gain { env = ad; attack = 20ms; peak = 0.6; curve = linear; }
  }

  seq cast {
    start = 20ms;
    step pad { voice = shimmer; at = 0s; duration = 700ms; vary_pitch = -15cents..15cents; }
    step dust { voice = sparks; at = 50ms; duration = 600ms; }
  }

  variants { base = 101; alt = 102; }
  playback = oneshot;
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

// Waveguide + Whoosh mono compilation & defaults work cleanly.
const bow = `ashfox 1
sound bow_tap {
  profile = foley;
  duration = 0.45s;
  channels = 1;
  seed = 9;

  voice body : waveguide {
    model = string;
    pitch = log(0: 260hz -> 1: 210hz);
    damping = 0.28;
    stiffness = 0.25;
    brightness = 0.72;
    highpass = 45hz;
    drive : tape { amount = 1.4; }
    gain { env = ad; attack = 4ms; peak = 0.9; }
  }

  voice flight : whoosh {
    velocity = lin(0: 0.4 -> 0.3: 2.4 -> 1: 0.2);
    thickness = 0.02;
    doppler = 0.8;
    noise_tone = 0.65;
    gain { env = ad; attack = 6ms; peak = 0.8; curve = exp; }
  }

  seq tap {
    step hit { voice = body; at = 0s; duration = 350ms; }
    step air { voice = flight; at = 20ms; duration = 320ms; }
  }

  variants { base = 1; }
  master { gain = 0db; peak = -2db; punch = 30%; limit = true; }
}`;
const tapProducts = compileSoundSource(bow, 'bow_tap.ashfox');
assert.equal(tapProducts[0]!.channels, 1);
assert.ok(tapProducts[0]!.rms > 0.01);

process.stdout.write(
  'dsp: SVF, PolyBLEP unison, granular, waveguide, whoosh, fx rack, duck, drift, space & master ok\n',
);
