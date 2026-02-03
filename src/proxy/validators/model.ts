import type { ModelPipelinePayload } from '../../spec';
import type { Limits, ToolResponse } from '../../types';
import { errWithCode } from '../response';
import { MODEL_OR_STAGES_REQUIRED, MODEL_STAGES_CONFLICT, PLAN_ONLY_NO_ENSURE, PLAN_ONLY_NO_EXTRAS } from '../../shared/messages';
import {
  validatePayloadSchema,
  validateModelSpecs,
  validatePlanOnlyConstraints,
  validationOk
} from './common';
import { toolSchemas } from '../../shared/mcpSchemas/toolSchemas';

export const validateModelPipeline = (payload: ModelPipelinePayload, limits: Limits): ToolResponse<void> => {
  void limits;
  const schemaErr = validatePayloadSchema('model_pipeline', payload, toolSchemas.model_pipeline);
  if (schemaErr) return schemaErr;
  const hasModel = Boolean(payload.model);
  const hasStages = Array.isArray(payload.stages) && payload.stages.length > 0;
  if (hasModel && hasStages) {
    return errWithCode('invalid_payload', MODEL_STAGES_CONFLICT);
  }
  if (!hasModel && !hasStages) {
    return errWithCode('invalid_payload', MODEL_OR_STAGES_REQUIRED);
  }
  const models = hasStages
    ? payload.stages!.map((stage) => stage.model)
    : payload.model
      ? [payload.model]
      : [];
  const modelErr = validateModelSpecs(models);
  if (modelErr) return modelErr;
  const planOnlyErr = validatePlanOnlyConstraints(
    payload,
    { noEnsure: PLAN_ONLY_NO_ENSURE, noExtras: PLAN_ONLY_NO_EXTRAS },
    { includeExport: true }
  );
  if (planOnlyErr) return planOnlyErr;
  return validationOk();
};
