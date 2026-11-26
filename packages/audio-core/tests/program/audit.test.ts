import assert from 'node:assert/strict';
import {
  compileSoundSource,
  evaluateSoundQuality,
  formatSoundGateFailure,
  renderSoundInspectSheet,
} from '../../src';

// 1. Rich multi-layer impact passes >= 85.
const craftedImpact = compileSoundSource(
  `ashfox 1
sound impact_crafted {
  profile = impact;
  duration = 0.55s;
  channels = 2;
  seed = 11;
  space { preset = small_chamber; mix = 20%; decay = 0.25s; damping = 5500hz; size = 0.7; }
  voice thud : resonator {
    excitation mallet { duration = 10ms; hardness = 85%; }
    mode sub { hz = 95hz; decay = 0.24s; gain = 1; }
    mode body { hz = 240hz; decay = 0.16s; gain = 0.7; }
    mode snap { hz = 1650hz; decay = 60ms; gain = 0.45; }
    pitch_drop_cents = 180cents;
    pitch_drop_seconds = 35ms;
    drive = 3.2;
    highpass = 35hz;
    lowpass = 12000hz;
    gain { env = ad; attack = 4ms; peak = 1; curve = exp; }
  }
  voice grit : noise {
    color = pink;
    filter bandpass {
      cutoff = 6500hz -> 650hz;
      q = 1.1;
    }
    drive = 1.8;
    pan = 0.15;
    gain { env = ad; attack = 4ms; peak = 0.95; curve = exp; }
  }
  voice air : noise {
    color = white;
    highpass = 5200hz;
    gain { env = ad; attack = 3ms; peak = 0.35; curve = exp; }
  }
  seq hit {
    start = 10ms;
    step a { voice = thud; at = 0s; duration = 0.45s; vary_pitch = -35cents..35cents; }
    step b { voice = grit; at = 0s; duration = 0.28s; vary_duration = 90%..110%; }
    step c { voice = air; at = 0s; duration = 80ms; }
  }
  variant base { seed = 21; }
  variant alt { seed = 22; }
  master { gain = 3db; peak = -2db; punch = 35%; warmth = 15%; air = 15%; glue = 25%; width = 1.1; limit = true; }
}`,
  'impact_crafted.ashfox',
);

const impactAudit = evaluateSoundQuality(craftedImpact);
assert.equal(impactAudit.passed, true, formatSoundGateFailure('impact_crafted', impactAudit));
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
  voice sine : osc { waveform = sine; pitch = 440hz; gain { env = ad; attack = 10ms; peak = 0.8; } }
  seq s { start = 0s; step n { voice = sine; at = 0s; duration = 0.48s; } }
  variant a { seed = 1; }
  variant b { seed = 2; }
  master { gain = -6db; peak = -3db; }
}`,
  'bare.ashfox',
);
const badAudit = evaluateSoundQuality(bareSine);
assert.equal(badAudit.passed, false);
assert.ok(badAudit.hardGates.some((g) => g.id === 'spectral_non_trivial' && !g.passed));
assert.ok(badAudit.hardGates.some((g) => g.id === 'variant_distinctness' && !g.passed));
assert.match(formatSoundGateFailure('bare_beep', badAudit), /failed quality gate/);

// 4. A weak non-first variant must fail audible_headroom across the exported collection.
const weakSecond = [craftedImpact[0]!, { ...craftedImpact[1]!, rms: 0.0014, peak: 0.01 }] as const;
const weakAudit = evaluateSoundQuality(weakSecond);
assert.equal(weakAudit.passed, false);
assert.ok(weakAudit.hardGates.some((g) => g.id === 'audible_headroom' && !g.passed));

console.log(`sound audit calibration ok: impact=${impactAudit.score} bad=${badAudit.score}`);
