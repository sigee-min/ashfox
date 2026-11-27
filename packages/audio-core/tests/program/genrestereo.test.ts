import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  compileSoundSource,
  evaluateSoundQuality,
  formatSoundGateFailure,
  parseSoundUnit,
  type SoundSourceUnit,
} from '../../src';

const STD_SOUND_DIR = path.resolve(__dirname, '../../../../library/std/sound');

const loadModule = (rel: string): SoundSourceUnit => {
  const full = path.join(STD_SOUND_DIR, rel);
  return parseSoundUnit(fs.readFileSync(full, 'utf8'), full);
};

const renderModuleRecipe = (
  rel: string,
  profile: 'impact' | 'foley' | 'creature' | 'ui' | 'ambient',
  duration: string,
  steps: readonly {
    readonly id: string;
    readonly voice: string;
    readonly at: string;
    readonly dur: string;
  }[],
  loopCfg?: string,
) => {
  const mod = loadModule(rel);
  const voiceIds = new Set(mod.voices.map((v) => v.id));
  for (const s of steps) assert.ok(voiceIds.has(s.voice), `Missing voice ${s.voice} in ${rel}`);

  const unitSrc = fs.readFileSync(path.join(STD_SOUND_DIR, rel), 'utf8').trimEnd();
  assert.ok(unitSrc.endsWith('}'), `Expected closing brace in ${rel}`);
  const modVoices = unitSrc
    .replace(
      /^ashfox 1\s+module\s+\w+\s*\{/,
      `ashfox 1\nsound test_${mod.id} {\n  profile = ${profile};\n  duration = ${duration};\n  channels = 2;\n  seed = 77;\n  space { preset = courtyard; mix = 20%; }`,
    )
    .replace(/\bexport\s+voice\b/g, 'voice')
    .replace(
      /\}$/,
      `  seq play { start = 10ms; ${steps
        .map((s) => `step ${s.id} { voice = ${s.voice}; at = ${s.at}; duration = ${s.dur}; }`)
        .join(
          ' ',
        )} }\n  variants { a = 11; b = 23; }\n  ${loopCfg ?? 'playback = oneshot;'}\n  master { gain = 0db; peak = -1.5db; limit = true; }\n}`,
    );

  const products = compileSoundSource(modVoices, rel);
  assert.equal(products.length, 2);
  assert.equal(products[0]!.channels, 2);
  const audit = evaluateSoundQuality(products);
  assert.equal(audit.passed, true, formatSoundGateFailure(rel, audit));
  return { products, audit };
};

renderModuleRecipe('weapon/gunshot.ashfox', 'impact', '0.65s', [
  { id: 'bolt', voice: 'bolt_snap', at: '0ms', dur: '60ms' },
  { id: 'crack', voice: 'muzzle_crack', at: '2ms', dur: '160ms' },
  { id: 'punch', voice: 'blast_punch', at: '0ms', dur: '220ms' },
  { id: 'tail', voice: 'outdoor_tail', at: '18ms', dur: '520ms' },
]);

renderModuleRecipe('weapon/energy.ashfox', 'impact', '0.75s', [
  { id: 'chg', voice: 'capacitor_charge', at: '0ms', dur: '280ms' },
  { id: 'zap', voice: 'laser_zap', at: '120ms', dur: '320ms' },
  { id: 'pls', voice: 'plasma_blast', at: '120ms', dur: '360ms' },
  { id: 'rail', voice: 'railgun_crack', at: '125ms', dur: '420ms' },
]);

renderModuleRecipe('weapon/reload.ashfox', 'foley', '0.9s', [
  { id: 'ej', voice: 'mag_eject', at: '0ms', dur: '180ms' },
  { id: 'ins', voice: 'mag_insert', at: '240ms', dur: '220ms' },
  { id: 'rack', voice: 'bolt_rack', at: '480ms', dur: '260ms' },
  { id: 'tink', voice: 'casing_tink', at: '620ms', dur: '240ms' },
]);

renderModuleRecipe(
  'mech/servo.ashfox',
  'ambient',
  '1.4s',
  [
    { id: 'whir', voice: 'servo_whir', at: '10ms', dur: '1.2s' },
    { id: 'chop', voice: 'rotor_chop', at: '0ms', dur: '1.35s' },
    { id: 'hum', voice: 'shield_hum', at: '0ms', dur: '1.35s' },
    { id: 'brk', voice: 'shield_shatter', at: '200ms', dur: '600ms' },
  ],
  'loop { at = 0.2s..1.15s; xfade = 80ms; }',
);

renderModuleRecipe(
  'creature/zombie.ashfox',
  'creature',
  '1.2s',
  [
    { id: 'grn', voice: 'zombie_groan', at: '0ms', dur: '650ms' },
    { id: 'bit', voice: 'zombie_bite', at: '120ms', dur: '240ms' },
    { id: 'ror', voice: 'zombie_roar', at: '320ms', dur: '700ms' },
    { id: 'hrd', voice: 'horde_ambience', at: '0ms', dur: '1.15s' },
  ],
  'loop { at = 0.2s..1.0s; xfade = 70ms; }',
);

renderModuleRecipe(
  'weather/storm.ashfox',
  'ambient',
  '1.6s',
  [
    { id: 'rain', voice: 'heavy_rain', at: '0ms', dur: '1.55s' },
    { id: 'thn', voice: 'distant_thunder', at: '40ms', dur: '1.2s' },
    { id: 'gale', voice: 'storm_gale', at: '0ms', dur: '1.55s' },
    { id: 'hb', voice: 'tense_heartbeat', at: '180ms', dur: '650ms' },
  ],
  'loop { at = 0.25s..1.35s; xfade = 80ms; }',
);

console.log('multi-genre true-stereo physical audio synthesis & audit ok');
