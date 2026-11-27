'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { readJson, sha256 } = require('../shared');
const root = path.resolve(__dirname, '../..');
const samples = ['sword_slash', 'claw_hit', 'footsteps', 'fire_loop', 'griffin_call'];
const goldenPath = path.join(__dirname, 'sound-golden.json');

const assertSoundCapabilities = (run) => {
  const capabilities = JSON.parse(run(['doctor', '--json'])).result.sound;
  assert.deepEqual(capabilities.features, [
    'curves',
    'envelopes',
    'filters',
    'eq',
    'drive',
    'fx',
    'duck',
    'drift',
    'space',
    'stereo',
    'sequences',
    'variation',
    'loops',
    'material',
    'granular',
    'whoosh',
    'waveguide',
    'mastering',
  ]);
  assert.ok(capabilities.sources.includes('material'));
  assert.ok(capabilities.sources.includes('granular'));
  assert.ok(capabilities.sources.includes('whoosh'));
  assert.ok(capabilities.sources.includes('waveguide'));
  assert.ok(!capabilities.sources.includes('resonator'));
  return capabilities;
};

const verifySoundSample = (run, soundsDir, name) => {
  const source = fs.readFileSync(
    path.join(root, 'showcase/assets/sounds', name + '.ashfox'),
    'utf8',
  );
  const input = path.join(soundsDir, name + '.ashfox');
  fs.writeFileSync(input, source);
  const inspected = JSON.parse(run(['check', input])).result;
  const built = JSON.parse(run(['build', input, '--json'])).result;
  const sampleResults = inspected.variants.map((variant) => {
    const ch = variant.channels ?? 1;
    const output = path.join(built.exports[0].directory, name, variant.variant + '.wav');
    const wav = fs.readFileSync(output);
    assert.equal(wav.length, 44 + variant.frames * 2 * ch);
    assert.equal(wav.readUInt32LE(24), 48000);
    assert.equal(wav.readUInt16LE(22), ch);
    if (variant.playback.kind === 'loop') {
      assert.deepEqual(variant.playback, {
        kind: 'loop',
        startFrame: 0,
        endFrame: variant.frames,
      });
    }
    return {
      name,
      variant: variant.variant,
      frames: variant.frames,
      playback: variant.playback,
      sha256: sha256(wav),
    };
  });
  const legacyJson = `ashfox-model 1
sound legacy_json {
  profile = "ui";
  duration = 0.5;
  sampleRate = 48000;
  seed = 1;
  voices = [];
  sequences = [];
  variants = [{ id = "base"; seed = 1; }];
  playback = { kind = "oneshot"; };
  output = { gainDb = 0; peakDb = -2; };
}`;
  fs.writeFileSync(input, legacyJson);
  assert.throws(() => run(['check', input, '--json']), /Command failed/);
  const legacyResonator = `ashfox 1
sound legacy_resonator {
  profile = ui;
  duration = 0.5s;
  seed = 1;
  voice body : resonator {
    gain { env = ad; attack = 5ms; }
  }
  seq hit {
    step a { voice = body; at = 0ms; duration = 0.4s; }
  }
  master { peak = -2db; }
}`;
  fs.writeFileSync(input, legacyResonator);
  assert.throws(() => run(['check', input, '--json']), /Command failed/);
  return sampleResults;
};

const verifySoundCli = (cli, write = false) => {
  const temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ashfox-release-sound-'));
  const run = (args) =>
    execFileSync(process.execPath, [cli, ...args], {
      cwd: temp,
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
    });
  try {
    const capabilities = assertSoundCapabilities(run);
    const soundsDir = path.join(temp, 'assets/sounds');
    fs.mkdirSync(soundsDir, { recursive: true });
    const results = samples.flatMap((name) => verifySoundSample(run, soundsDir, name));
    const receipt = { contract: capabilities.contract, results };
    assert.ok(results.some((r) => r.name === 'claw_hit' && r.frames > 0));
    assert.ok(results.some((r) => r.name === 'fire_loop' && r.playback.kind === 'loop'));
    if (write) fs.writeFileSync(goldenPath, JSON.stringify(receipt, null, 2) + '\n');
    else
      assert.deepEqual(
        receipt,
        readJson(goldenPath),
        'Installed CLI must reproduce reviewed sound bytes and playback metadata',
      );
    console.log(
      'Release sound contract: five features, exact PCM corpus and old grammar rejection pass',
    );
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
};
if (require.main === module)
  verifySoundCli(
    path.resolve(
      process.argv.slice(2).find((arg) => arg !== '--write') || 'apps/cli/dist/ashfox.cjs',
    ),
    process.argv.includes('--write'),
  );
module.exports = { verifySoundCli };
