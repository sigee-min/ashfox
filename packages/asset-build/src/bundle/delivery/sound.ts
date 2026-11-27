import {
  evaluateSoundQuality,
  formatSoundGateFailure,
  type SoundProduct,
} from '@ashfox/audio-core';
import { BuildFailure, type AssetMetadata } from '../contract';
import { appendHooksArtifact, type ProductByKind, type ProductDeliveryStrategy } from './contract';

export const assertSoundGate = (targetName: string, sounds: readonly SoundProduct[]): void => {
  const audit = evaluateSoundQuality(sounds);
  if (!audit.passed) {
    throw new BuildFailure('quality.gate', formatSoundGateFailure(targetName, audit), 3);
  }
};

export const buildSoundMetadata = (sounds: readonly SoundProduct[]): AssetMetadata => ({
  variants: sounds.map((sound) => ({
    id: sound.variant,
    frames: sound.frames,
    sample_rate: sound.sample_rate,
    channels: sound.channels,
    playback: sound.playback,
    peak: sound.peak,
    rms: sound.rms,
    dc: sound.dc,
    seamDelta: sound.seamDelta,
    maxAdjacentDelta: sound.maxAdjacentDelta,
  })),
});

export const soundDeliveryStrategy: ProductDeliveryStrategy<ProductByKind['sound']> = {
  kind: 'sound',
  assertGate: (targetName, product) => assertSoundGate(targetName, product.sounds),
  compileArtifacts: (target, product) => ({
    files: appendHooksArtifact(
      product.sounds.map((s) => ({ path: `${target.name}/${s.variant}.wav`, bytes: s.wav })),
      target.name,
      product.hooks,
    ),
  }),
  buildMetadata: (product) => buildSoundMetadata(product.sounds),
};
