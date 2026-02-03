import type { Cube, TextureUsage } from '../../../domain/model';
import type { AtlasPlan } from '../../../domain/uv/atlas';
import type { UvFaceMap } from '../../../domain/uv/apply';
import type { TexturePlanDetail } from '../../../spec';

export type AutoPlanTextureSpec =
  | { mode: 'create'; name: string; width: number; height: number; background?: string }
  | { mode: 'update'; targetName: string; width: number; height: number; background?: string; useExisting: true };

export type AutoPlanBuildResult = {
  detail: TexturePlanDetail;
  padding: number;
  layout: PlanLayout;
  groups: TextureGroup[];
  atlas: AtlasPlan;
  uvPlan: { usage: TextureUsage; updates: Array<{ cubeId?: string; cubeName: string; faces: UvFaceMap }> };
  uvUsageId: string;
  notes: string[];
  textureSpecs: AutoPlanTextureSpec[];
};

export type CubeStat = { cube: Cube; area: number };

export type AutoPlanContext = {
  detail: TexturePlanDetail;
  padding: number;
  maxSize: number;
  formatFlags: { singleTexture?: boolean; perTextureUvSize?: boolean };
  allowSplit: boolean;
  maxTextures: number;
  stats: { totalArea: number; maxFaceWidth: number; maxFaceHeight: number; cubes: CubeStat[] };
  ppuTarget: number;
  resolutionOverride: { width: number; height: number } | null;
  layout: PlanLayout;
  existingNames: Set<string>;
  textureNames: string[];
  groups: TextureGroup[];
};

export type PlanLayout = {
  resolution: { width: number; height: number };
  textureCount: number;
  ppuTarget: number;
  ppuUsed: number;
};

export type TextureGroup = {
  name: string;
  cubes: Cube[];
  area: number;
};

