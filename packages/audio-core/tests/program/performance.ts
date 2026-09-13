import assert from 'node:assert/strict';
import { compileSoundSource, type SoundRecipe } from '../../src';
import { fixture, native } from './fixture';
const modal = process.argv[2] === 'modal', fm = process.argv[2] === 'fm', base = fixture();
const duration = modal ? 29 : 30;
const recipe: SoundRecipe = { ...base, duration,
  voices: [{ ...base.voices[0], gain: .1, source: modal ? { kind: 'resonator', excitation: { kind: 'noise', duration: .05 },
    modes: Array.from({ length: 16 }, (_, i) => ({ id: `m_${i}`, hz: 40 + i * 1000, decay: 10, gain: 1 })) } : fm ? { kind: 'fm', pitch: 3000, ratio: 4, index: 4, vibratoHz: 25, vibratoCents: 100 } : { kind: 'noise' } }],
  sequences: [{ ...base.sequences[0], steps: [{ ...base.sequences[0].steps[0], duration }] }],
  variants: Array.from({ length: modal ? 2 : fm ? 1 : 8 }, (_, i) => ({ id: `v_${i}`, seed: i + 1 })),
  playback: { kind: 'loop', start: 0, end: duration, crossfade: .002 }, output: { gainDb: -24, peakDb: -3 } };
const initial = process.memoryUsage().rss, start = performance.now();
const products = compileSoundSource(native(recipe), 'performance.ashfox');
const incrementalRss = Math.max(0, process.resourceUsage().maxRSS * 1024 - initial);
assert.ok(incrementalRss <= 256 * 1024 * 1024, `core scratch+products RSS ${incrementalRss} exceeds 256 MiB`);
assert.ok(products.every(p => p.frames === duration * 48000 - 96));
process.stdout.write(JSON.stringify({ workload: modal ? 'near-weighted-limit' : fm ? 'fm-oversampling-limit' : 'maximum-output-variants', node: process.version,
  platform: process.platform, elapsedMs: performance.now() - start, incrementalRss, weightedFrames: duration * 48000 * (modal ? 68 : fm ? 128 : 1) * recipe.variants.length }) + '\n');
