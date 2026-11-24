import type { AssetSymbolId } from '../contract';
import type { SourceSpan } from '../../../../project/source/contract';
import type { Vec3 } from '../../../../model/identity';
import type { TextureAsset } from '../../../../model/texture';

export type GrainMode = 'clustered' | 'soft' | 'none';

export interface ChartAuthoringTelemetry {
  readonly id: string;
  readonly layout: 'box' | 'flat';
  readonly visibleTexels: number;
  readonly authoredDeltaTexels: number;
  readonly aoTexels: number;
  readonly protectedTexels: number;
  readonly distinctRoles: number;
  readonly regionGrainModes: Readonly<Record<string, GrainMode>>;
  readonly faceSymmetry: Readonly<Record<string, number>>;
}

export interface TextureAuthoringTelemetry {
  readonly textureId: string;
  readonly tone: 'none' | 'voxel' | 'painterly';
  readonly defaultGrain: GrainMode;
  readonly charts: readonly ChartAuthoringTelemetry[];
}

export interface AssetAuthoringTelemetry {
  readonly textures: Readonly<Record<string, TextureAuthoringTelemetry>>;
}

export interface SceneObb {
  readonly id: string;
  readonly chartKey: string | null;
  readonly origin: Vec3;
  readonly size: Vec3;
  readonly pivot: Vec3;
  readonly position: Vec3;
  readonly rotation: Vec3;
  readonly placementOffset: Vec3;
  readonly center: Vec3;
  readonly half: Vec3;
  readonly ax: Vec3;
  readonly ay: Vec3;
  readonly az: Vec3;
  readonly aabbMin: Vec3;
  readonly aabbMax: Vec3;
}

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
 */
export interface AssetTexturePlan {
  readonly surfaceSymbol: AssetSymbolId;
  readonly texture: TextureAsset;
  readonly charts: Readonly<Record<string, AssetTextureChartPlan>>;
  readonly telemetry?: TextureAuthoringTelemetry;
}

export type AssetTextureIssue = (
  path: string,
  span: SourceSpan,
  code: string,
  message: string,
) => void;
