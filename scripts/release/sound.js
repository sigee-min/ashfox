'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { readJson, sha256 } = require('../shared');
const root = path.resolve(__dirname, '../..');
const samples = [
  'bell_pattern',
  'wind_loop',
  'footsteps',
  'charging_spell',
  'metal_strike',
  'bird_call',
];
const goldenPath = path.join(__dirname, 'sound-golden.json');

const assertSoundCapabilities = (run) => {
  const capabilities = JSON.parse(run(['doctor', '--json'])).result.sound;
  assert.deepEqual(capabilities.features, [
    'curves',
    'envelopes',
    'filters',
    'drive',
    'space',
    'stereo',
    'sequences',
    'variation',
    'loops',
  ]);
  assert.ok(capabilities.sources.includes('resonator'));
  return capabilities;
};

const verifySoundSample = (run, soundsDir, name) => {
  const source = fs.readFileSync(
    path.join(root, 'examples/sounds/assets/sounds', name + '.ashfox'),
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
  fs.writeFileSync(input, source.replace('voices =', 'layers ='));
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
    const moduleDir = path.join(temp, 'assets/module');
    fs.mkdirSync(soundsDir, { recursive: true });
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.copyFileSync(
      path.join(root, 'examples/sounds/assets/module/bird_voices.ashfox'),
      path.join(moduleDir, 'bird_voices.ashfox'),
    );
    const results = samples.flatMap((name) => verifySoundSample(run, soundsDir, name));
    const receipt = { contract: capabilities.contract, results };
    assert.ok(results.some((r) => r.name === 'bell_pattern' && r.frames === 96960));
    assert.ok(results.some((r) => r.name === 'wind_loop' && r.frames === 188160));
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
