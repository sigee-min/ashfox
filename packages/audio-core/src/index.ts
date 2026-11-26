import { compareText } from '@ashfox/internal-contracts';
import { parseSoundDocument } from './source';
import { SoundError, fail } from './validate';
import { render, master, measure } from './render';
import { encodeWav } from './wav';
import { bakeLoop } from './loop';
import { frame } from './curve';
import { readRecipe } from './read';
import { validatePlan } from './plan';
import type { SoundProduct, SoundRecipe } from './contract';
export {
  parseSoundSource,
  parseSoundUnit,
  type SoundImportDecl,
  type SoundNamedDecl,
  type SoundOutputRaw,
  type SoundPreviewRaw,
  type SoundSourceUnit,
} from './source';
export { readRecipe } from './read';
export { render, master, measure } from './render';
export { encodeWav } from './wav';
export { AUDIO_POLICY } from './random';
export { SOUND_PROFILES } from './contract';
export {
  DEFAULT_SOUND_THRESHOLD,
  evaluateSoundQuality,
  formatSoundGateFailure,
  type SoundAuditDeduction,
  type SoundAuditGateResult,
  type SoundAuditOptions,
  type SoundAuditPillarId,
  type SoundAuditPillarReport,
  type SoundAuditReport,
  type SoundAuditSubmetric,
  type SoundGateId,
  type SoundQualityGrade,
} from './audit';
export { renderSoundInspectSheet } from './sheet';
export type { SoundBudget } from './plan';
export const soundBudget = (recipe: SoundRecipe) => validatePlan(readRecipe(recipe));
export const soundRecipeBudget = (rawRecipe: unknown) => validatePlan(readRecipe(rawRecipe));
export type {
  SoundRecipe,
  SoundProduct,
  SoundPlayback,
  SoundProfile,
  SoundVoice,
  SoundVariant,
  SoundSource,
  Control,
  Curve,
  EnvelopeControl,
  GainControl,
  FilterSpec,
  SpaceSpec,
} from './contract';

const renderVariantProduct = (
  recipe: SoundRecipe,
  variant: SoundRecipe['variants'][number],
): SoundProduct => {
  const channels = recipe.channels ?? 1;
  const pcm = master(
    bakeLoop(render(recipe, variant), recipe.playback, channels),
    recipe.output,
    channels,
  );
  const wav = encodeWav(pcm, recipe.sampleRate, channels);
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  for (let i = 0; i < pcm.length; i++) pcm[i] = view.getInt16(44 + i * 2, true) / 32767;
  const stats = measure(pcm, channels);
  if (stats.peak === 0) fail('recipe.output.gainDb', 'output quantizes to silence');
  if (stats.peak > 10 ** (recipe.output.peakDb / 20))
    fail(
      'recipe.output.gainDb',
      `decoded PCM16 peak ${stats.peak} exceeds ceiling; lower gainDb below ${(recipe.output.gainDb + 20 * Math.log10(10 ** (recipe.output.peakDb / 20) / stats.peak)).toFixed(3)}`,
    );
  const frames = pcm.length / channels;
  const playback =
    recipe.playback.kind === 'oneshot'
      ? ({ kind: 'oneshot' } as const)
      : ({ kind: 'loop', startFrame: 0, endFrame: frames } as const);
  return Object.freeze({
    id: recipe.id,
    profile: recipe.profile,
    variant: variant.id,
    wav,
    frames,
    rawFrames: frame(recipe.duration),
    sampleRate: 48000,
    channels,
    ...stats,
    playback: Object.freeze(playback),
  });
};

export const compileSoundRecipe = (
  rawRecipe: unknown,
  file = 'sound.ashfox',
): readonly SoundProduct[] => {
  const recipe = readRecipe(rawRecipe);
  const sorted = [...recipe.variants].sort((a, b) => compareText(a.id, b.id));
  return Object.freeze(
    sorted.map((variant) => {
      try {
        return renderVariantProduct(recipe, variant);
      } catch (error) {
        if (error instanceof SoundError) {
          throw new SoundError(error.path, `${file}: ${error.detail}; variant ${variant.id}`);
        }
        throw error;
      }
    }),
  );
};

export const compileSoundSource = (source: string, file: string): readonly SoundProduct[] => {
  const { recipe, report } = parseSoundDocument(source, file);
  const sorted = [...recipe.variants].sort((a, b) => compareText(a.id, b.id));
  return Object.freeze(
    sorted.map((variant) => {
      try {
        return renderVariantProduct(recipe, variant);
      } catch (error) {
        return report(
          error instanceof SoundError
            ? new SoundError(error.path, `${error.detail}; variant ${variant.id}`)
            : error,
        );
      }
    }),
  );
};
