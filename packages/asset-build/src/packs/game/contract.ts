import type { SoundProduct } from '@ashfox/audio-core';
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
          id: string;
          file: string;
          durationSeconds: number;
          sampleRate: number;
          channels: number;
          frames: number;
          playback: SoundProduct['playback'];
        }>[];
      }>
  );
export interface GameAssetManifest {
  readonly format: 'ashfox-game-assets';
  readonly version: 1;
  readonly assets: readonly RuntimeAsset[];
}
