import assert from 'node:assert/strict';
import { compileSoundSource, parseSoundSource, readRecipe } from '../../src';

// Verify Audio 2.0 DSP chain: SVF filter, PolyBLEP unison osc, granular ember, mallet resonator, drive, space, stereo pan, envelope shorthand, and mastering limiter.
const stereoMagic = `ashfox-model 1
sound magic_cast {
  profile = "magic";
  duration = 0.8;
  sampleRate = 48000;
  channels = 2;
  seed = 77;
  space = { preset = "ethereal"; mix = 0.25; decay = 0.35; damping = 6500; size = 0.9; };
  voices = [{
    id = "shimmer";
    source = {
      kind = "osc";
      waveform = "saw";
      pitch = {
        domain = "log";
        interpolation = "smooth";
        points = [{ at = 0; value = 320; }, { at = 0.4; value = 640; }, { at = 1; value = 480; }];
      };
      unison = 3;
      detuneCents = 18;
    };
    filter = {
      kind = "bandpass";
      cutoff = {
        domain = "log";
        interpolation = "smooth";
        points = [{ at = 0; value = 500; }, { at = 1; value = 4200; }];
      };
      q = 2.4;
    };
    drive = 2.5;
    pan = -0.35;
    gain = { env = "adsr"; attack = 0.03; decay = 0.15; sustain = 0.55; release = 0.25; peak = 0.9; curve = "exp"; };
  }, {
    id = "sparks";
    source = { kind = "granular"; texture = "ember"; density = 120; };
    filter = { kind = "highpass"; cutoff = 1800; q = 1.2; };
    pan = 0.45;
    gain = { env = "ad"; attack = 0.02; peak = 0.6; curve = "linear"; };
  }];
  sequences = [{
    id = "cast";
    start = 0.02;
    steps = [
      { id = "pad"; voice = "shimmer"; at = 0; duration = 0.7; vary = { pitchCents = [-15, 15]; }; },
      { id = "dust"; voice = "sparks"; at = 0.05; duration = 0.6; }
    ];
  }];
  variants = [{ id = "base"; seed = 101; }, { id = "alt"; seed = 102; }];
  playback = { kind = "oneshot"; };
  output = { gainDb = -3; peakDb = -1; punch = 0.2; warmth = 0.15; air = 0.25; glue = 0.25; width = 1.15; limit = true; };
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

// Mallet resonator + pitchDrop compiles cleanly.
const wood = `ashfox-model 1
sound wood_tap {
  profile = "foley";
  duration = 0.35;
  sampleRate = 48000;
  seed = 9;
  voices = [{
    id = "body";
    source = {
      kind = "resonator";
      excitation = { kind = "mallet"; duration = 0.008; hardness = 0.6; };
      modes = [
        { id = "m1"; hz = 240; decay = 0.14; gain = 1; },
        { id = "m2"; hz = 590; decay = 0.08; gain = 0.4; }
      ];
      pitchDropCents = 120;
      pitchDropSeconds = 0.025;
    };
    gain = { env = "ad"; attack = 0.004; peak = 0.9; };
    highpass = 45;
  }];
  sequences = [{ id = "tap"; start = 0; steps = [{ id = "hit"; voice = "body"; at = 0; duration = 0.3; }]; }];
  variants = [{ id = "base"; seed = 1; }];
  playback = { kind = "oneshot"; };
  output = { gainDb = 0; peakDb = -2; punch = 0.3; limit = true; };
}`;
const tapProducts = compileSoundSource(wood, 'wood_tap.ashfox');
assert.equal(tapProducts[0]!.channels, 1);
assert.ok(tapProducts[0]!.rms > 0.01);

process.stdout.write(
  'dsp 2.0: SVF, PolyBLEP unison osc, granular ember, mallet pitchDrop, drive, space, stereo, master & envelopes ok\n',
);
