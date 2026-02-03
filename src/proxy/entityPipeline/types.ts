import type { EnsureProjectResult, ValidateResult } from '../../types';
import type { PipelineStepsResult } from '../pipelineResult';
import type { ApplyReport } from '../apply';
import type { AppliedReport, ModelPlan, StageResult } from '../modelPipeline/types';
import type { EntityFormat, GeckoLibTargetVersion } from '../../shared/toolConstants';
import type { TexturePipelineSteps } from '../texturePipeline/types';
import type { UvRecoveryInfo } from '../uvRecovery';
import type { RenderPreviewStructured } from '../../types/preview';

export type EntityModelResult = {
  applied: true;
  plan: ModelPlan['summary'];
  report: AppliedReport;
  warnings?: string[];
};

export type EntityModelStageResult = StageResult & {
  report: AppliedReport;
};

export type EntityTextureResult = {
  applied: true;
  report: ApplyReport;
  recovery?: UvRecoveryInfo;
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
  modelStages?: EntityModelStageResult[];
  texturePlan?: TexturePipelineSteps['plan'];
  textures?: EntityTextureResult;
  presets?: TexturePipelineSteps['presets'];
  facePaint?: {
    applied: number;
    materials: string[];
    textures: string[];
    textureIds?: string[];
    uvUsageId?: string;
    recovery?: UvRecoveryInfo;
  };
  cleanup?: { applied: number; deleted: Array<{ id?: string; name: string }> };
  animations?: EntityAnimationResult;
  preview?: RenderPreviewStructured;
  validate?: ValidateResult;
};

export type EntityPipelineResult = PipelineStepsResult<
  EntityPipelineSteps,
  { applied: boolean; planOnly?: boolean; format: EntityFormat; targetVersion: GeckoLibTargetVersion }
>;


