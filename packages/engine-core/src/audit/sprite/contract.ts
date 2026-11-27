import { DEFAULT_AUDIT_THRESHOLD } from '@ashfox/internal-contracts';
import type { SpriteAuthoringTelemetry } from '../../compiler/sprite/contract';
import type { SpriteNineSlice, SpriteProfile } from '../../project/sprite/contract';
import type { CanonicalTextureRaster } from '../../textures/textureRecipe/raster';
import type { AuditProfileSource, AuditSubmetric, QualityGrade } from '../contract';

export type SpriteAuditPillarId = 'silhouette' | 'color' | 'surface';

export type SpriteGateId =
  | 'non_empty_canvas'
  | 'no_crushed_blacks'
  | 'no_stray_pixels'
  | 'tile_seamless_wrap'
  | 'anti_raw_noise'
  | 'nine_slice_margins'
  | 'crosshair_symmetry'
  | 'hud_bar_separation'
  | 'decal_soft_alpha'
  | 'decal_no_border_clip';

export interface SpriteAuditGateResult {
  readonly id: SpriteGateId;
  readonly passed: boolean;
  readonly message: string;
  readonly fix: string;
}

export interface SpriteAuditPillarReport {
  readonly id: SpriteAuditPillarId;
  readonly label: string;
  readonly score: number;
  readonly maxScore: number;
  readonly metrics: readonly AuditSubmetric[];
}

export interface SpriteAuditDeduction {
  readonly metricId: string;
  readonly pillar: SpriteAuditPillarId | 'gate';
  readonly lostPoints: number;
  readonly summary: string;
  readonly fix: string;
}

export interface SpriteAuditInput {
  readonly profile: SpriteProfile;
  readonly nineSlice?: SpriteNineSlice;
  readonly raster: CanonicalTextureRaster;
  readonly telemetry: SpriteAuthoringTelemetry;
}

export interface SpriteAuditOptions {
  readonly profile?: SpriteProfile;
  readonly threshold?: number;
}

export interface SpriteAuditReport {
  readonly schemaVersion: 1;
  readonly profile: SpriteProfile;
  readonly profileSource: AuditProfileSource;
  readonly threshold: number;
  readonly passed: boolean;
  readonly score: number;
  readonly grade: QualityGrade;
  readonly hardGates: readonly SpriteAuditGateResult[];
  readonly pillars: readonly SpriteAuditPillarReport[];
  readonly topDeductions: readonly SpriteAuditDeduction[];
}

export const DEFAULT_SPRITE_THRESHOLD = DEFAULT_AUDIT_THRESHOLD;
