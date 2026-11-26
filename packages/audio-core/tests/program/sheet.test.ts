import assert from 'node:assert/strict';
import { compileSoundSource, evaluateSoundQuality, renderSoundInspectSheet } from '../../src';

const oneshot = compileSoundSource(
  `ashfox 1
sound sheet_oneshot {
  profile = ui;
  duration = 0.28s;
  seed = 5;
  voice ping : osc {
    waveform = triangle;
    pitch = 880hz -> 1320hz;
    unison = 2;
    detune_cents = 8cents;
    filter lowpass { cutoff = 6400hz; q = 1.2; }
    gain { env = ad; attack = 5ms; peak = 0.85; curve = exp; }
  }
  voice spark : noise { color = white; highpass = 4500hz; gain { env = ad; attack = 3ms; peak = 0.25; curve = exp; } }
  seq chime { start = 10ms; step a { voice = ping; at = 0s; duration = 0.24s; } step b { voice = spark; at = 0s; duration = 50ms; } }
  variant take1 { seed = 101; }
  master { peak = -1db; gain = 2db; punch = 25%; air = 15%; limit = true; }
}`,
  'oneshot.ashfox',
);

const loop = compileSoundSource(
  `ashfox 1
sound sheet_loop {
  profile = ambient;
  duration = 1s;
  channels = 2;
  seed = 9;
  loop { at = 0s..1s; xfade = 50ms; }
  space { preset = timber_room; mix = 25%; decay = 0.4s; damping = 4200hz; size = 0.8; }
  voice bed : noise {
    color = pink;
    filter bandpass { cutoff = 480hz -> 1200hz -> 480hz; q = 1.6; }
    gain = 0.5 -> 0.9 -> 0.5;
  }
  seq main { start = 0s; step s { voice = bed; at = 0s; duration = 1s; } }
  variant v1 { seed = 1; }
  variant v2 { seed = 2; }
  master { peak = -2db; gain = 4db; warmth = 20%; glue = 25%; width = 1.1; limit = true; }
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
