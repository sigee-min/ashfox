import type { DamageStateKind, ModelDamageStateMeta } from '../model/hitzone';

export const SDK_TARGETS = ['three', 'unity', 'godot'] as const;

export type SdkTarget = (typeof SDK_TARGETS)[number];
export type { DamageStateKind };

export interface GeneratedSdkFile {
  readonly target: SdkTarget;
  readonly fileName: string;
  readonly content: string;
}

export interface SdkManifestSoundVariant {
  readonly id: string;
  readonly file: string;
  readonly durationSeconds?: number;
  readonly sampleRate?: number;
  readonly channels?: number;
  readonly playback?: {
    readonly kind: string;
    readonly startFrame?: number;
    readonly endFrame?: number;
  };
  readonly loopStartSample?: number;
  readonly loopEndSample?: number;
}

export interface SdkManifestAsset {
  readonly id: string;
  readonly kind: 'model' | 'structure' | 'sprite' | 'sound' | 'vfx';
  readonly path?: string;
  readonly model?: string;
  readonly image?: string;
  readonly meta?: string;
  readonly vfxSpec?: string;
  readonly hooks?: string;
  readonly codec?: 'wav' | 'ogg';
  readonly clips?: readonly { readonly name: string; readonly durationSeconds: number }[];
  readonly variants?: readonly SdkManifestSoundVariant[];
  readonly colliders?: unknown;
  readonly damageState?: ModelDamageStateMeta;
}

export interface SdkManifestInput {
  readonly name?: string;
  readonly baseUrl?: string;
  readonly assets: readonly SdkManifestAsset[];
}

export interface SdkGenerationOptions {
  readonly namespace?: string;
  readonly classPrefix?: string;
  readonly manifest?: SdkManifestInput;
}

export interface SdkTargetStrategy {
  readonly target: SdkTarget;
  readonly files: (options?: SdkGenerationOptions) => readonly GeneratedSdkFile[];
}
