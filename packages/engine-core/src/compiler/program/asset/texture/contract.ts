import type { AssetSymbolId } from '../contract';
import type { SourceSpan } from '../../../../project/source/contract';
import type { TextureAsset } from '../../../../model/texture';

/** The normalized chart record consumed by canonical lowering. */
export interface AssetTextureChartPlan {
  readonly id: string;
  readonly layout: 'box' | 'flat';
  readonly origin: readonly [number, number];
  readonly width: number;
  readonly height: number;
  readonly coverage: string | null;
  /** Source owner retained for canonical lowering diagnostics. */
  readonly span: SourceSpan;
}

/** Geometry usage collected after component instantiation. */
export interface AssetTextureUsage {
  readonly chart: string;
  readonly shape: Readonly<
    | {
        readonly kind: 'box';
        readonly size: readonly [number, number, number];
      }
    | {
        readonly kind: 'flat';
        readonly size: readonly [number, number];
      }
  >;
  readonly span: SourceSpan;
}

/**
 * Compiler-private texture product. All source operations have already been
 * reduced to the canonical texture raster and its deterministic PNG digest.
 * The source blob reference carries the digest and byte length; raw encoded
 * bytes are intentionally not retained in the compiler product.
 */
export interface AssetTexturePlan {
  readonly surfaceSymbol: AssetSymbolId;
  readonly texture: TextureAsset;
  readonly charts: Readonly<Record<string, AssetTextureChartPlan>>;
}

export type AssetTextureIssue = (
  path: string,
  span: SourceSpan,
  code: string,
  message: string,
) => void;
