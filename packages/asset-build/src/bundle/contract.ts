import type { SoundProduct } from '@ashfox/audio-core';
import type {
  DirectoryFile,
  DirectoryWorkspace,
  GeneratedBindingFile,
  GlbPerformanceMetrics,
} from '@ashfox/engine-core';
export interface Snapshot {
  readonly input: string;
  readonly root: string;
  readonly configuration: string;
  readonly config: DirectoryWorkspace;
  readonly files: readonly DirectoryFile[];
  readonly hash: string;
}
export interface Artifact {
  readonly path: string;
  readonly bytes: Uint8Array;
}
export interface FileRecord {
  readonly path: string;
  readonly sha256: string;
  readonly byteLength: number;
}
export type AssetMetadata =
  | {
      readonly resourceRoot: 'game-assets';
      readonly manifest: 'assets.json';
      readonly archive: string | null;
    }
  | {
      readonly minecraftVersion: string;
      readonly resourceRoot: 'resource-pack';
      readonly archive: string | null;
    }
  | { readonly width: number; readonly height: number }
  | {
      readonly size: readonly [number, number, number];
      readonly blockCount: number;
      readonly interiorCells: number;
      readonly zoneCount?: number;
      readonly lightCount?: number;
      readonly interactableCount?: number;
      readonly performance?: GlbPerformanceMetrics;
    }
  | {
      readonly clips: readonly { readonly name: string; readonly durationSeconds: number }[];
      readonly performance?: GlbPerformanceMetrics;
    }
  | {
      readonly durationSeconds: number;
      readonly fps: number;
      readonly drawCalls: number;
      readonly triangles: number;
      readonly particleCount: number;
    }
  | {
      readonly variants: readonly {
        readonly id: string;
        readonly frames: number;
        readonly sample_rate: number;
        readonly channels: 1 | 2;
        readonly playback: SoundProduct['playback'];
        readonly peak: number;
        readonly rms: number;
        readonly dc: number;
        readonly seamDelta: number;
        readonly maxAdjacentDelta: number;
      }[];
    };
export interface CatalogAsset {
  readonly id: string;
  readonly kind: 'model' | 'sprite' | 'sound' | 'structure' | 'vfx' | 'pack';
  readonly directory: string;
  readonly metadata: AssetMetadata;
  readonly files: readonly FileRecord[];
}
export interface Catalog {
  readonly format: 'ashfox-catalog';
  readonly version: 1;
  readonly assets: readonly CatalogAsset[];
}
export interface Receipt {
  readonly format: 'ashfox-build-receipt';
  readonly version: 1;
  readonly sourceHash: string;
  readonly requestKey: string;
  readonly toolchain: string;
  readonly catalogHash: string;
  readonly files: readonly FileRecord[];
}
export interface CompiledBundle {
  readonly receipt: Receipt;
  readonly catalog: Catalog;
  readonly artifacts: readonly Artifact[];
  readonly bundleHash: string;
  readonly bindings?: readonly GeneratedBindingFile[];
}
export interface FailureDiagnostic {
  readonly severity?: 'error' | 'warning';
  readonly code: string;
  readonly file?: string;
  readonly message: string;
  readonly hint?: string;
}

export class BuildFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly exitCode = 1,
    readonly diagnostics?: readonly FailureDiagnostic[],
    readonly hint?: string,
  ) {
    super(message);
  }
}

export interface LoopAudioMetadata {
  readonly startSample: number;
  readonly lengthSamples: number;
}

export interface PackEncoder {
  readonly fingerprint: string;
  readonly encode: (wav: Uint8Array, loop?: LoopAudioMetadata) => Promise<Uint8Array>;
}
