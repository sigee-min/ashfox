import assert from 'node:assert/strict';
import { compileSoundSource, parseSoundSource } from '../../src';

// 1. Native Sound DSL (ashfox 1) block syntax, units, curves, envelopes, and smart defaults.
const dsl = `ashfox 1
sound dsl_demo {
  profile = foley;
  duration = 450ms;
  seed = 777;
  space { preset = timber_room; mix = 22%; decay = 320ms; damping = 5.5khz; }

  voice body : waveguide {
    model = blade;
    pitch = log(0: 480hz -> 1: 620hz);
    damping = 0.3;
    stiffness = 0.65;
    brightness = 0.8;
    highpass = 80hz;
    eq { low = (140hz, 2db); mid = (1.4khz, -1.5db, 1.2); high = (6khz, 1.5db); }
    drive : tube { amount = 1.6; }
    fx : chorus { mix = 20%; rate = 1.8hz; depth = 30%; }
    pan = -0.65 -> 0.65;
    gain { env = adsr; attack = 8ms; decay = 90ms; sustain = 0.65; release = 110ms; peak = 0.92; curve = exp; }
  }

  voice wind : aero_whoosh {
    velocity = lin(0: 0.3 -> 0.4: 2.1 -> 1: 0.2);
    thickness = 0.04;
    doppler = 0.7;
    sweep_pan = -0.5 -> 0.7;
    duck { by = body; amount = 35%; release_ms = 60ms; }
    drift { target = pan; depth = 25%; rate = 1.2hz; }
    gain { env = ad; attack = 6ms; peak = 0.8; curve = exp; }
  }

  seq hit {
    start = 10ms;
    step blade { voice = body; at = 0s; duration = 380ms; vary_timing = -4ms..4ms; vary_pitch = -35cents..35cents; vary_gain = 90%..110%; }
    step air { voice = wind; at = 15ms; duration = 350ms; }
  }

  master { gain = 3db; target = -13lufs; peak = -1.5db; punch = 35%; limit = true; }
}`;

const recipe = parseSoundSource(dsl, 'dsl_demo.ashfox');
assert.equal(recipe.sample_rate, 48000);
assert.equal(recipe.channels, 2);
assert.deepEqual(recipe.playback, { kind: 'oneshot' });
assert.equal(recipe.variants.length, 2);
assert.deepEqual(
  recipe.variants.map((v) => v.id),
  ['alternate', 'base'],
);
assert.equal(recipe.duration, 0.45);

const products = compileSoundSource(dsl, 'dsl_demo.ashfox');
assert.equal(products.length, 2);
assert.equal(products[0]!.channels, 2);
assert.notDeepEqual(products[0]!.wav, products[1]!.wav);

// 2. Hard-cut rejection of legacy headers, camelCase keys, JSON syntax, and removed resonator source.
for (const legacy of [
  `ashfox-model 1 sound old_hdr { profile = ui; duration = 0.3s; seed = 1; master { peak = -2db; } }`,
  `ashfox 1 sound old_arr { profile = ui; duration = 0.3s; seed = 1; voices = []; sequences = []; master { peak = -2db; } }`,
  `ashfox 1 sound old_obj { profile = ui; duration = 0.3s; seed = 1; voice v : noise { color = "white"; gain = 0.5; } seq t { step a { voice = v; at = 0s; duration = 0.2s; } } master { peak = -2db; } }`,
  `ashfox 1 sound old_res { profile = ui; duration = 0.3s; seed = 1; voice v : resonator { gain { env = ad; attack = 5ms; } } seq t { step a { voice = v; at = 0s; duration = 0.2s; } } master { peak = -2db; } }`,
  `ashfox 1 sound old_rate { profile = ui; duration = 0.3s; sampleRate = 48000; seed = 1; voice v : noise { color = white; gain = 0.5; } seq t { step a { voice = v; at = 0s; duration = 0.2s; } } master { peak = -2db; } }`,
]) {
  assert.throws(() => parseSoundSource(legacy, 'legacy.ashfox'), /legacy-syntax|legacy-source/);
}

process.stdout.write(
  'sound dsl: ashfox 1 blocks, units, shorthand curves, smart defaults, and legacy rejection passed\n',
);
