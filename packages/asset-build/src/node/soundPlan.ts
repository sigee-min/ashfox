import type { SoundBudget, SoundOutputRaw, SoundPreviewRaw } from '@ashfox/audio-core';
import {
  prepareDirectorySound,
  validateAssetDeclarations,
  type DirectoryFile,
} from '@ashfox/engine-core';
import { BuildFailure } from '../bundle/contract';

const SOUND_LIMITS = {
  sources: 32,
  outputFrames: 11520000,
  eventFrames: 24000000,
  weightedFrames: 192000000,
} as const;

export interface PreparedNodeSound {
  readonly entryId: string;
  readonly resolvedRecipe: Readonly<Record<string, unknown>>;
  readonly budget: SoundBudget;
  readonly soundPaths: readonly string[];
  readonly outputs: readonly SoundOutputRaw[];
  readonly previews: readonly SoundPreviewRaw[];
}

export const prepareNodeSound = (
  files: ReadonlyMap<string, DirectoryFile>,
  entryPath: string,
  entryName: string,
): PreparedNodeSound => {
  const prepared = prepareDirectorySound(files, entryPath);
  if (prepared.unit.id !== entryName) {
    throw new Error('Entry name must match sound id: ' + entryPath);
  }
  validateAssetDeclarations('sound', prepared.unit.outputs, prepared.unit.previews, entryPath);
  return {
    entryId: prepared.unit.id,
    resolvedRecipe: prepared.resolvedRecipe,
    budget: prepared.budget,
    soundPaths: prepared.soundPaths,
    outputs: prepared.unit.outputs,
    previews: prepared.unit.previews,
  };
};

export const assertWorkspaceSoundBudget = (
  entryPath: string,
  sources: number,
  total: { outputFrames: number; eventFrames: number; weightedFrames: number },
): void => {
  const exceeded =
    sources > SOUND_LIMITS.sources ||
    total.outputFrames > SOUND_LIMITS.outputFrames ||
    total.eventFrames > SOUND_LIMITS.eventFrames ||
    total.weightedFrames > SOUND_LIMITS.weightedFrames;
  if (exceeded) {
    const message = `${entryPath}: sound workspace budget exceeded: sources=${sources}/32, rawFrames=${total.outputFrames}/11520000, eventFrames=${total.eventFrames}/24000000, weightedFrames=${total.weightedFrames}/192000000`;
    throw new BuildFailure(
      'workspace.compile',
      JSON.stringify([{ code: 'workspace.compile', file: '.ashfoxworkspace', message }]),
    );
  }
};
