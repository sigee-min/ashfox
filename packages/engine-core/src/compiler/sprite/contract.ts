import type { CanonicalTextureRaster } from '../../textures/textureRecipe/raster';
import type { SpriteDiagnostic } from '../../project/sprite/contract';
export interface SpritePixelEvidence {
  readonly layer: string; readonly pointer: string; readonly material: string | null;
  readonly baseTone: number | null; readonly grainDelta: number;
  readonly protected: boolean; readonly patch: string | null;
}
export interface SpriteReceipt {
  readonly id: string; readonly sourceHash: string; readonly closureHash: string;
  readonly policy: string; readonly buildKey: string; readonly productHash: string; readonly pngHash: string;
  readonly width: number; readonly height: number; readonly colors: number;
  readonly bounds: readonly [number, number, number, number];
}
export interface SpriteProduct {
  readonly id: string; readonly raster: CanonicalTextureRaster; readonly png: Uint8Array;
  readonly stages: Readonly<Record<'silhouette' | 'shade' | 'grain', CanonicalTextureRaster>>;
  readonly evidence: readonly (SpritePixelEvidence | null)[];
  readonly receipt: SpriteReceipt;
}
export type SpriteBuild = { readonly ok: true; readonly sourceHash: string; readonly products: readonly SpriteProduct[] } |
  { readonly ok: false; readonly diagnostics: readonly SpriteDiagnostic[] };
