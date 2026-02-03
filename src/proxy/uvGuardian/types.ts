import type { Cube, TextureUsage } from '../../domain/model';
import type { TextureTargetSet } from '../../domain/uv/targets';
import type { ToolResponse } from '../../types';
import type { ProxyPipelineDeps } from '../types';
import type { MetaOptions } from '../meta';
import type { TexturePipelinePlan } from '../../spec';
import type { TexturePipelineContext } from '../texturePipeline/steps';
import type { UvRecoveryInfo } from '../uvRecovery';

export type UvGuardFailure =
  | 'uv_overlap'
  | 'uv_scale_mismatch'
  | 'uv_usage_mismatch'
  | 'uv_usage_missing'
  | 'unknown';

export type UvRecoveryPlanOptions = {
  context: TexturePipelineContext;
  existingPlan?: TexturePipelinePlan | null;
  name?: string;
  maxTextures?: number;
  ifRevision?: string;
  reuseExistingTextures?: boolean;
};

export type UvRecoveryAtlasOptions = {
  ifRevision?: string;
};

export type UvGuardianOptions = {
  deps: ProxyPipelineDeps;
  meta: MetaOptions;
  targets: TextureTargetSet;
  uvUsageId?: string;
  usageOverride?: TextureUsage;
  uvContext?: { cubes: Cube[]; resolution?: { width: number; height: number } };
  requireUv?: boolean;
  plan?: UvRecoveryPlanOptions;
  atlas?: UvRecoveryAtlasOptions;
};

export type UvGuardianResult = {
  usage: TextureUsage;
  uvUsageId: string;
  recovery?: UvRecoveryInfo;
};

export type GuardWithFn = (
  uvUsageId: string | undefined,
  usageOverride?: TextureUsage
) => ToolResponse<UvGuardianResult>;

