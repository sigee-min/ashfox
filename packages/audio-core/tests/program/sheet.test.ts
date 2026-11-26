import assert from 'node:assert/strict';
import { compileSoundSource, evaluateSoundQuality, renderSoundInspectSheet } from '../../src';

const oneshot = compileSoundSource(
  `ashfox-model 1
sound sheet_oneshot {
  profile = "ui";
  duration = 0.28;
  sampleRate = 48000;
  seed = 5;
  voices = [{
    id = "ping";
    source = { kind = "osc"; waveform = "triangle"; pitch = { domain = "log"; interpolation = "smooth"; points = [{ at = 0; value = 880; }, { at = 1; value = 1320; }]; }; unison = 2; detuneCents = 8; };
    filter = { kind = "lowpass"; cutoff = 6400; q = 1.2; };
    gain = { env = "ad"; attack = 0.005; peak = 0.85; curve = "exp"; };
  }, {
    id = "spark";
    source = { kind = "noise"; color = "white"; };
    highpass = 4500;
    gain = { env = "ad"; attack = 0.003; peak = 0.25; curve = "exp"; };
  }];
  sequences = [{
    id = "chime";
    start = 0.01;
    steps = [
      { id = "a"; voice = "ping"; at = 0; duration = 0.24; },
      { id = "b"; voice = "spark"; at = 0; duration = 0.05; }
    ];
  }];
  variants = [{ id = "take1"; seed = 101; }];
  playback = { kind = "oneshot"; };
  output = { peakDb = -1; gainDb = 2; softClip = true; };
}`,
  'oneshot.ashfox',
);

const loop = compileSoundSource(
  `ashfox-model 1
sound sheet_loop {
  profile = "ambient";
  duration = 1.0;
  sampleRate = 48000;
  channels = 2;
  seed = 9;
  playback = { kind = "loop"; start = 0; end = 1.0; crossfade = 0.05; };
  space = { mix = 0.25; decay = 0.4; damping = 4200; size = 0.8; };
  voices = [{
    id = "bed";
    source = { kind = "noise"; color = "pink"; };
    filter = {
      kind = "bandpass";
      cutoff = { domain = "log"; interpolation = "smooth"; points = [{ at = 0; value = 480; }, { at = 0.5; value = 1200; }, { at = 1; value = 480; }]; };
      q = 1.6;
    };
    gain = { domain = "linear"; interpolation = "smooth"; points = [{ at = 0; value = 0.5; }, { at = 0.5; value = 0.9; }, { at = 1; value = 0.5; }]; };
  }];
  sequences = [{
    id = "main";
    start = 0;
    steps = [{ id = "s"; voice = "bed"; at = 0; duration = 1.0; }];
  }];
  variants = [{ id = "v1"; seed = 1; }, { id = "v2"; seed = 2; }];
  output = { peakDb = -2; gainDb = 4; softClip = true; };
}`,
  'loop.ashfox',
);

for (const products of [oneshot, loop]) {
  const report = evaluateSoundQuality(products);
  const sheet = renderSoundInspectSheet(products, report);
  assert.equal(sheet.width, 800);
  assert.equal(sheet.height, 520);
  assert.equal(sheet.rgba.length, 800 * 520 * 4);
  let nonZeroAlpha = 0;
  for (let i = 3; i < sheet.rgba.length; i += 4) if (sheet.rgba[i]! > 0) nonZeroAlpha += 1;
  assert.equal(nonZeroAlpha, 800 * 520);
}

console.log('audio sheet test ok');
