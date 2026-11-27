import type { CanonicalTextureRaster } from '../../textures/textureRecipe/raster';
import type {
  SpriteDiagnostic,
  SpriteNineSlice,
  SpriteProfile,
} from '../../project/sprite/contract';

export interface SpritePixelEvidence {
  readonly layer: string;
  readonly op: string;
  readonly pointer: string;
  readonly material: string | null;
  readonly baseTone: number | null;
  readonly grainDelta: number;
  readonly protected: boolean;
  readonly patch: string | null;
}

export interface SpriteAuthoringTelemetry {
  readonly width: number;
  readonly height: number;
  readonly profile: SpriteProfile;
  readonly opaquePixels: number;
  readonly layerCount: number;
  readonly authoredPatternPixels: number;
  readonly outlinePixels: number;
  readonly materialCount: number;
  readonly hasRimHighlight: boolean;
}

export interface SpriteReceipt {
  readonly id: string;
  readonly profile: SpriteProfile;
  readonly sourceHash: string;
  readonly closureHash: string;
  readonly policy: string;
  readonly buildKey: string;
  readonly productHash: string;
  readonly pngHash: string;
  readonly width: number;
  readonly height: number;
  readonly colors: number;
  readonly bounds: readonly [number, number, number, number];
}

export interface SpriteProduct {
  readonly id: string;
  readonly profile: SpriteProfile;
  readonly nineSlice?: SpriteNineSlice;
  readonly raster: CanonicalTextureRaster;
  readonly png: Uint8Array;
  readonly stages: Readonly<Record<'silhouette' | 'shade' | 'grain', CanonicalTextureRaster>>;
  readonly evidence: readonly (SpritePixelEvidence | null)[];
  readonly telemetry: SpriteAuthoringTelemetry;
  readonly receipt: SpriteReceipt;
}

export type SpriteBuild =
  | { readonly ok: true; readonly sourceHash: string; readonly products: readonly SpriteProduct[] }
  | { readonly ok: false; readonly diagnostics: readonly SpriteDiagnostic[] };
