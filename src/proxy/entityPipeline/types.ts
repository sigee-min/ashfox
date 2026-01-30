import type { EnsureProjectResult } from '../../types';
import type { PipelineStepsResult } from '../pipelineResult';
import type { ApplyReport } from '../apply';
import type { AppliedReport, ModelPlan } from '../modelPipeline/types';
import type { EntityFormat, GeckoLibTargetVersion } from '../../shared/toolConstants';
import type { TexturePipelineSteps } from '../texturePipeline/types';

export type EntityModelResult = {
  applied: true;
  plan: ModelPlan['summary'];
  report: AppliedReport;
  warnings?: string[];
};

export type EntityTextureResult = {
  applied: true;
  report: ApplyReport;
  recovery?: Record<string, unknown>;
  uvUsageId?: string;
};

export type EntityAnimationResult = {
  applied: true;
  clips: string[];
  keyframes: number;
};

export type EntityPipelineSteps = {
  project?: EnsureProjectResult;
  model?: EntityModelResult;
  texturePlan?: TexturePipelineSteps['plan'];
  textures?: EntityTextureResult;
  presets?: TexturePipelineSteps['presets'];
  facePaint?: { applied: number; materials: string[]; textures: string[]; uvUsageId?: string; recovery?: Record<string, unknown> };
  cleanup?: { applied: number; deleted: Array<{ id?: string; name: string }> };
  animations?: EntityAnimationResult;
};

export type EntityPipelineResult = PipelineStepsResult<
  EntityPipelineSteps,
  { applied: boolean; planOnly?: boolean; format: EntityFormat; targetVersion: GeckoLibTargetVersion }
>;
