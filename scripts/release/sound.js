'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const samples = ['bell_pattern', 'wind_loop', 'footsteps', 'charging_spell', 'metal_strike', 'bird_call'];
const goldenPath = path.join(__dirname, 'sound-golden.json');
const verifySoundCli = (cli, write = false) => {
  const temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ashfox-release-sound-'));
  const run = args => execFileSync(process.execPath, [cli, ...args], {
    cwd: temp, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024,
  });
  try {
    const capabilities = JSON.parse(run(['capabilities'])).result.sound;
    assert.deepEqual(capabilities.features, ['curves', 'sequences', 'variation', 'loops']);
    assert.ok(capabilities.sources.includes('resonator'));
    const results = [];
    for (const name of samples) {
      const source = fs.readFileSync(path.join(root, 'examples/sounds/src', name + '.ashfox'), 'utf8');
      const input = path.join(temp, name + '.ashfox');
      fs.writeFileSync(input, source);
      const inspected = JSON.parse(run(['inspect', input]));
      for (const variant of inspected.variants) {
        const output = path.join(temp, name + '-' + variant.variant + '.wav');
        run(['export', input, '--variant', variant.variant, '--output', output]);
        const wav = fs.readFileSync(output);
        assert.equal(wav.length, 44 + variant.frames * 2);
        assert.equal(wav.readUInt32LE(24), 48000);
        assert.equal(wav.readUInt16LE(22), 1);
        if (variant.playback.kind === 'loop') assert.deepEqual(variant.playback, { kind: 'loop', startFrame: 0, endFrame: variant.frames });
        results.push({ name, variant: variant.variant, frames: variant.frames, playback: variant.playback,
          sha256: createHash('sha256').update(wav).digest('hex') });
      }
      const old = source.replace('voices =', 'layers =');
      fs.writeFileSync(input, old);
      assert.throws(() => run(['check', input, '--json']), /Command failed/);
    }
    const receipt = { contract: capabilities.contract, results };
    assert.ok(results.some(r => r.name === 'bell_pattern' && r.frames === 96960));
    assert.ok(results.some(r => r.name === 'wind_loop' && r.frames === 188160));
    if (write) fs.writeFileSync(goldenPath, JSON.stringify(receipt, null, 2) + '\n');
    else assert.deepEqual(receipt, JSON.parse(fs.readFileSync(goldenPath, 'utf8')),
      'Installed CLI must reproduce reviewed sound bytes and playback metadata');
    console.log('Release sound contract: five features, exact PCM corpus and old grammar rejection pass');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
};
if (require.main === module) verifySoundCli(path.resolve(process.argv.slice(2).find(arg => arg !== '--write') || 'apps/cli/dist/ashfox.cjs'), process.argv.includes('--write'));
module.exports = { verifySoundCli };
