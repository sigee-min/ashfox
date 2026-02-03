import type { TexturePipelinePlan } from '../spec';
import type { TexturePipelineSteps } from './texturePipeline/types';

type PlanStep = NonNullable<TexturePipelineSteps['plan']>;

export type UvRecoveryReason =
  | 'uv_overlap'
  | 'uv_scale_mismatch'
  | 'uv_usage_mismatch'
  | 'uv_usage_missing'
  | 'uv_missing';

export type UvRecoveryMethod = 'plan' | 'auto_uv_atlas' | 'preflight_refresh';

export type UvRecoveryInfo = {
  source: 'autoRecover';
  reason: UvRecoveryReason;
  method: UvRecoveryMethod;
  uvUsageId?: string;
  detail?: PlanStep['detail'];
  resolution?: PlanStep['resolution'];
  textureCount?: number;
  notes?: string[];
  planName?: string;
  steps?: number;
};

export const buildPreflightRecoveryInfo = (reason: UvRecoveryReason): UvRecoveryInfo => ({
  source: 'autoRecover',
  reason,
  method: 'preflight_refresh'
});

export const buildPlanRecoveryInfo = (
  reason: UvRecoveryReason,
  planStep: TexturePipelineSteps['plan'] | undefined,
  plan: TexturePipelinePlan
): UvRecoveryInfo => ({
  source: 'autoRecover',
  reason,
  method: 'plan',
  ...(planStep
    ? {
        detail: planStep.detail,
        resolution: planStep.resolution,
        textureCount: planStep.textures.length,
        notes: planStep.notes,
        planName: plan.name
      }
    : { planName: plan.name })
});

export const buildAtlasRecoveryInfo = (
  reason: UvRecoveryReason,
  atlas?: { steps?: number; resolution?: { width: number; height: number } },
  notes?: string[]
): UvRecoveryInfo => ({
  source: 'autoRecover',
  reason,
  method: 'auto_uv_atlas',
  ...(atlas?.steps !== undefined ? { steps: atlas.steps } : {}),
  ...(atlas?.resolution ? { resolution: atlas.resolution } : {}),
  ...(notes && notes.length > 0 ? { notes } : {})
});


