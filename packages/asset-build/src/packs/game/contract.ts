import type { SoundProduct } from '@ashfox/audio-core';
import type { ModelColliderSet, ModelDamageStateMeta } from '@ashfox/engine-core';
import type { FileRecord } from '../../bundle/contract';
interface RuntimeAssetBase {
  readonly id: string;
  readonly files: readonly FileRecord[];
}
export type RuntimeAsset = RuntimeAssetBase &
  (
    | Readonly<{
        kind: 'model';
        model: string;
        coordinateSystem: 'gltf2';
        unitsPerMeter: number;
        requiredExtensions: readonly string[];
        clips: readonly Readonly<{ name: string; durationSeconds: number }>[];
        colliders?: ModelColliderSet;
        damageState?: ModelDamageStateMeta;
      }>
    | Readonly<{
        kind: 'structure';
        model: string;
        meta: string;
        coordinateSystem: 'gltf2';
        unitsPerBlock: 1;
        requiredExtensions: readonly string[];
        size: readonly [number, number, number];
        zoneCount: number;
        lightCount: number;
        interactableCount: number;
      }>
    | Readonly<{
        kind: 'sprite';
        image: string;
        width: number;
        height: number;
        pixelsPerUnit: number;
        filter: 'nearest' | 'linear';
      }>
    | Readonly<{
        kind: 'sound';
        codec: 'wav' | 'ogg';
        variants: readonly Readonly<{
          readonly id: string;
          readonly file: string;
          readonly durationSeconds: number;
          readonly sample_rate: number;
          readonly sampleRate: number;
          readonly channels: number;
          readonly frames: number;
          readonly playback: SoundProduct['playback'];
          readonly loopStartSample?: number;
          readonly loopEndSample?: number;
        }>[];
      }>
  );
export interface GamePackOptions {
  readonly deduplicateTextures?: boolean;
}
export interface GameAssetManifest {
  readonly format: 'ashfox-game-assets';
  readonly version: 1;
  readonly sharedTextures?: readonly FileRecord[];
  readonly assets: readonly RuntimeAsset[];
}
