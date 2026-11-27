import {
  type GeneratedSdkFile,
  type SdkGenerationOptions,
  type SdkManifestInput,
  type SdkTarget,
  type SdkTargetStrategy,
} from './contract';
import { GODOT_SDK_STRATEGY } from './godot';
import { THREE_SDK_STRATEGY } from './three';
import { UNITY_SDK_STRATEGY } from './unity';

export {
  SDK_TARGETS,
  type GeneratedSdkFile,
  type SdkGenerationOptions,
  type SdkManifestAsset,
  type SdkManifestInput,
  type SdkManifestSoundVariant,
  type SdkTarget,
  type SdkTargetStrategy,
} from './contract';

export const SDK_GENERATORS: Readonly<Record<SdkTarget, SdkTargetStrategy>> = Object.freeze({
  three: THREE_SDK_STRATEGY,
  unity: UNITY_SDK_STRATEGY,
  godot: GODOT_SDK_STRATEGY,
});

/** Generate zero-dependency runtime SDK source files for a single engine target. */
export const generateRuntimeSdk = (
  target: SdkTarget,
  manifest?: SdkManifestInput,
  options?: Omit<SdkGenerationOptions, 'manifest'>,
): readonly GeneratedSdkFile[] => {
  const strategy = SDK_GENERATORS[target];
  return strategy.files({ ...options, ...(manifest ? { manifest } : {}) });
};

/** Generate runtime SDK source files across all supported engine targets. */
export const generateAllRuntimeSdks = (
  manifest?: SdkManifestInput,
  options?: Omit<SdkGenerationOptions, 'manifest'>,
): Readonly<Record<SdkTarget, readonly GeneratedSdkFile[]>> =>
  Object.freeze({
    three: generateRuntimeSdk('three', manifest, options),
    unity: generateRuntimeSdk('unity', manifest, options),
    godot: generateRuntimeSdk('godot', manifest, options),
  });
