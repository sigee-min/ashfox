import assert from 'node:assert/strict';
import {
  compileSoundSource,
  evaluateSoundQuality,
  formatSoundGateFailure,
  renderSoundInspectSheet,
} from '../../src';

// 1. Rich multi-layer audio impact passes >= 85.
const craftedImpact = compileSoundSource(
  `ashfox 1
sound impact_demo {
  profile = impact;
  duration = 0.55s;
  sample_rate = 48000hz;
  channels = 2;
  seed = 11;
  space { preset = small_chamber; mix = 20%; decay = 250ms; damping = 5500hz; size = 0.7; }

  voice thud : modal_plate {
    material = leather;
    pitch = 95hz;
    size = 1.2;
    hardness = 0.85;
    damping = 0.65;
    brightness = 0.65;
    modes = 14;
    strike = mallet;
    splash = 0.55;
    stereo_spread = 0.45;
    highpass = 35hz;
    lowpass = 12000hz;
    eq { low = (110hz, 2.5db); }
    drive : tube { amount = 2.4; }
    gain { env = ad; attack = 4ms; peak = 1; curve = exp; }
  }

  voice grit : aero_whoosh {
    velocity = lin(0: 0.4 -> 0.25: 2.2 -> 1: 0.25);
    thickness = 0.03;
    doppler = 0.65;
    sweep_pan = -0.5 -> 0.55;
    noise_tone = 0.72;
    filter : bandpass { cutoff = log(0: 6500hz -> 1: 650hz); q = 1.1; }
    drive : grit { amount = 1.8; }
    duck { by = thud; amount = 30%; release_ms = 60ms; }
    gain { env = ad; attack = 4ms; peak = 0.95; curve = exp; }
  }

  voice air : noise {
    color = white;
    highpass = 5200hz;
    pan = 0.2;
    gain { env = ad; attack = 3ms; peak = 0.45; curve = exp; }
  }

  seq hit {
    start = 10ms;
    step a { voice = thud; at = 0s; duration = 450ms; vary_pitch = -35cents..35cents; }
    step b { voice = grit; at = 0s; duration = 280ms; vary_duration = 90%..110%; }
    step c { voice = air; at = 0s; duration = 80ms; }
  }

  variants { base = 21; alt = 22; }
  playback = oneshot;
  master { gain = 3db; peak = -2db; punch = 35%; warmth = 15%; air = 15%; glue = 25%; width = 1.1; limit = true; }
}`,
  'impact_demo.ashfox',
);

const impactAudit = evaluateSoundQuality(craftedImpact);
assert.equal(impactAudit.passed, true, formatSoundGateFailure('impact_demo', impactAudit));
assert.ok(impactAudit.score >= 85, `expected >= 85, got ${impactAudit.score}`);

// 2. Inspect sheet renders deterministic 800x520 RGBA.
const sheet1 = renderSoundInspectSheet(craftedImpact, impactAudit);
const sheet2 = renderSoundInspectSheet(craftedImpact, impactAudit);
assert.equal(sheet1.width, 800);
assert.equal(sheet1.height, 520);
assert.equal(sheet1.rgba.length, 800 * 520 * 4);
assert.deepEqual(sheet1.rgba, sheet2.rgba);

// 3. Static bare sine tone with identical variants fails spectral_non_trivial & variant_distinctness.
const bareSine = compileSoundSource(
  `ashfox 1
sound bare_beep {
  profile = ui;
  duration = 0.5s;
  seed = 1;
  voice sine : osc {
    waveform = sine;
    pitch = 440hz;
    gain { env = ad; attack = 10ms; peak = 0.8; }
  }
  seq s { step n { voice = sine; at = 0s; duration = 480ms; } }
  variants { a = 1; b = 2; }
  master { gain = -6db; peak = -3db; }
}`,
  'bare.ashfox',
);
const badAudit = evaluateSoundQuality(bareSine);
assert.equal(badAudit.passed, false);
assert.ok(badAudit.hardGates.some((g) => g.id === 'spectral_non_trivial' && !g.passed));
assert.ok(badAudit.hardGates.some((g) => g.id === 'variant_distinctness' && !g.passed));
assert.match(formatSoundGateFailure('bare_beep', badAudit), /failed quality gate/);

// 4. Out-of-phase inverted stereo fails stereo_phase gate cleanly.
const invertedStereo = [
  {
    ...craftedImpact[0]!,
    wav: (() => {
      const buf = Uint8Array.from(craftedImpact[0]!.wav);
      const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      for (let i = 46; i < buf.length; i += 4) {
        view.setInt16(i, Math.max(-32767, Math.min(32767, -view.getInt16(i - 2, true))), true);
      }
      return buf;
    })(),
  },
  craftedImpact[1]!,
] as const;
const phaseAudit = evaluateSoundQuality(invertedStereo);
assert.equal(phaseAudit.passed, false);
assert.ok(phaseAudit.hardGates.some((g) => g.id === 'stereo_phase' && !g.passed));

// 5. A weak non-first variant must fail audible_headroom across the exported collection.
const weakSecond = [craftedImpact[0]!, { ...craftedImpact[1]!, rms: 0.0014, peak: 0.01 }] as const;
const weakAudit = evaluateSoundQuality(weakSecond);
assert.equal(weakAudit.passed, false);
assert.ok(weakAudit.hardGates.some((g) => g.id === 'audible_headroom' && !g.passed));

console.log(`sound audit calibration ok: impact=${impactAudit.score} bad=${badAudit.score}`);
