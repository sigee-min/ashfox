import assert from 'node:assert/strict';
import {
  compileSoundSource,
  evaluateSoundQuality,
  formatSoundGateFailure,
  renderSoundInspectSheet,
} from '../../src';

// 1. Rich multi-layer impact passes >= 85.
const craftedImpact = compileSoundSource(
  `ashfox-model 1
sound impact_v2 {
  profile = "impact";
  duration = 0.55;
  sampleRate = 48000;
  channels = 2;
  seed = 11;
  space = { mix = 0.2; decay = 0.25; damping = 5500; size = 0.7; };
  voices = [{
    id = "thud";
    source = {
      kind = "resonator";
      excitation = { kind = "mallet"; duration = 0.01; hardness = 0.85; };
      modes = [
        { id = "sub"; hz = 95; decay = 0.24; gain = 1; },
        { id = "body"; hz = 240; decay = 0.16; gain = 0.7; },
        { id = "snap"; hz = 1650; decay = 0.06; gain = 0.45; }
      ];
      pitchDropCents = 180;
      pitchDropSeconds = 0.035;
    };
    drive = 3.2;
    highpass = 35;
    lowpass = 12000;
    gain = { env = "ad"; attack = 0.004; peak = 1; curve = "exp"; };
  }, {
    id = "grit";
    source = { kind = "noise"; color = "pink"; };
    filter = {
      kind = "bandpass";
      cutoff = { domain = "log"; interpolation = "smooth"; points = [{ at = 0; value = 6500; }, { at = 1; value = 650; }]; };
      q = 1.1;
    };
    drive = 1.8;
    pan = 0.15;
    gain = { env = "ad"; attack = 0.004; peak = 0.95; curve = "exp"; };
  }, {
    id = "air";
    source = { kind = "noise"; color = "white"; };
    highpass = 5200;
    gain = { env = "ad"; attack = 0.003; peak = 0.35; curve = "exp"; };
  }];
  sequences = [{
    id = "hit";
    start = 0.01;
    steps = [
      { id = "a"; voice = "thud"; at = 0; duration = 0.45; vary = { pitchCents = [-35, 35]; }; },
      { id = "b"; voice = "grit"; at = 0; duration = 0.28; vary = { duration = [0.9, 1.1]; }; },
      { id = "c"; voice = "air"; at = 0; duration = 0.08; }
    ];
  }];
  variants = [{ id = "base"; seed = 21; }, { id = "alt"; seed = 22; }];
  playback = { kind = "oneshot"; };
  output = { gainDb = 3; peakDb = -2; softClip = true; };
}`,
  'impact_v2.ashfox',
);

const impactAudit = evaluateSoundQuality(craftedImpact);
assert.equal(impactAudit.passed, true, formatSoundGateFailure('impact_v2', impactAudit));
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
  `ashfox-model 1
sound bare_beep {
  profile = "ui";
  duration = 0.5;
  sampleRate = 48000;
  seed = 1;
  voices = [{
    id = "sine";
    source = { kind = "osc"; waveform = "sine"; pitch = 440; };
    gain = { env = "ad"; attack = 0.01; peak = 0.8; };
  }];
  sequences = [{ id = "s"; start = 0; steps = [{ id = "n"; voice = "sine"; at = 0; duration = 0.48; }]; }];
  variants = [{ id = "a"; seed = 1; }, { id = "b"; seed = 2; }];
  playback = { kind = "oneshot"; };
  output = { gainDb = -6; peakDb = -3; };
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
