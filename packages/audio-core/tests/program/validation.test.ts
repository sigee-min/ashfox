import assert from 'node:assert/strict';
import { readRecipe } from '../../src';
import { SoundError } from '../../src/validate';
import { fixture } from './fixture';

const assertSoundError = (fn: () => unknown, pattern: RegExp, label: string): void => {
  assert.throws(
    fn,
    (err: unknown) => err instanceof SoundError && pattern.test(err.message),
    `expected SoundError matching ${pattern} for ${label}`,
  );
};

const base = fixture();

// 1. Legacy output.softClip rejected.
assertSoundError(
  () => readRecipe({ ...base, output: { gainDb: 0, peakDb: -1, softClip: true } }),
  /softClip.*unknown field/,
  'output.softClip',
);

// 2. Legacy noise.color = 'crackle' and noise.density rejected.
assertSoundError(
  () =>
    readRecipe({
      ...base,
      voices: [{ ...base.voices[0], source: { kind: 'noise', color: 'crackle' } }],
    }),
  /expected white \| pink \| brown/,
  'noise.color crackle',
);

assertSoundError(
  () =>
    readRecipe({
      ...base,
      voices: [{ ...base.voices[0], source: { kind: 'noise', color: 'white', density: 50 } }],
    }),
  /density.*unknown field/,
  'noise.density',
);

// 3. Empty space: {} rejected.
assertSoundError(
  () => readRecipe({ ...base, space: {} }),
  /space requires preset or at least one parameter/,
  'empty space',
);

// 4. Material bounces with strike != 'bounce' rejected.
assertSoundError(
  () =>
    readRecipe({
      ...base,
      voices: [
        {
          ...base.voices[0],
          source: { kind: 'material', material: 'steel', pitch: 440, strike: 'mallet', bounces: 3 },
        },
      ],
    }),
  /bounces requires strike = bounce/,
  'bounces with mallet',
);

assertSoundError(
  () =>
    readRecipe({
      ...base,
      voices: [
        {
          ...base.voices[0],
          source: { kind: 'material', material: 'steel', pitch: 440, bounces: 3 },
        },
      ],
    }),
  /bounces requires strike = bounce/,
  'bounces without strike',
);

// 5. Mono output.width !== 1 rejected (both explicit channels: 1 and width != 1).
assertSoundError(
  () => readRecipe({ ...base, channels: 1, output: { gainDb: 0, peakDb: -1, width: 1.2 } }),
  /width requires channels = 2/,
  'mono output.width > 1',
);

assertSoundError(
  () => readRecipe({ ...base, channels: 1, output: { gainDb: 0, peakDb: -1, width: 0 } }),
  /width requires channels = 2/,
  'mono output.width = 0',
);

// 6. Mismatched vocal formants / bandwidths lengths rejected, and vocal missing both vowels and formants rejected.
assertSoundError(
  () =>
    readRecipe({
      ...base,
      voices: [
        {
          ...base.voices[0],
          source: {
            kind: 'vocal',
            pitch: 220,
            formants: [500, 1500, 2500],
            bandwidths: [100, 200, 300, 400],
          },
        },
      ],
    }),
  /expected 3 bandwidths to match formants/,
  'vocal 3 formants vs 4 bandwidths',
);

assertSoundError(
  () =>
    readRecipe({
      ...base,
      voices: [{ ...base.voices[0], source: { kind: 'vocal', pitch: 220 } }],
    }),
  /vocal requires vowels or formants/,
  'vocal without vowels or formants',
);

// 7. Boundary & duck/drift/resonator checks.
assertSoundError(
  () => readRecipe({ ...base, space: { mix: 0.9 } }),
  /recipe\.space\.mix/,
  'space.mix > 0.7',
);

assertSoundError(
  () => readRecipe({ ...base, output: { gainDb: 0, peakDb: -1, targetLufs: -3 } }),
  /recipe\.output\.targetLufs/,
  'targetLufs > -6',
);

assertSoundError(
  () =>
    readRecipe({
      ...base,
      voices: [{ ...base.voices[0], duck: { by: 'tone', amount: 0.5, releaseMs: 80 } }],
    }),
  /cannot duck itself/,
  'self duck',
);

assertSoundError(
  () =>
    readRecipe({
      ...base,
      channels: 1,
      voices: [{ ...base.voices[0], drift: { target: 'pan', depth: 0.3 } }],
    }),
  /pan drift requires channels = 2/,
  'mono pan drift',
);

assertSoundError(
  () =>
    readRecipe({
      ...base,
      voices: [{ ...base.voices[0], source: { kind: 'resonator' } }],
    }),
  /unsupported source resonator/,
  'legacy resonator rejected',
);

process.stdout.write('validation: fail-closed SoundError guards passed\n');
