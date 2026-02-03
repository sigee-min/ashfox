import { validateTexturePipeline } from '../validators';
import type { TexturePipelinePayload } from '../../spec';
import type { ToolResponse } from '../../types';
import type { ProxyPipelineDeps } from '../types';
import type { TexturePipelineResult } from './types';
import { runProxyPipeline } from '../pipelineRunner';
import { getTexturePipelineClarificationQuestions } from '../clarifications';
import { decidePlanOnly } from '../planOnly';
import { runTexturePipeline } from './runTexturePipeline';

export const texturePipelineProxy = async (
  deps: ProxyPipelineDeps,
  payload: TexturePipelinePayload
): Promise<ToolResponse<TexturePipelineResult>> => {
  const planDecision = decidePlanOnly(payload.planOnly, getTexturePipelineClarificationQuestions(payload));
  const clarificationQuestions = planDecision.questions;
  const shouldPlanOnly = planDecision.shouldPlanOnly;
  return runProxyPipeline<TexturePipelinePayload, TexturePipelineResult>(deps, payload, {
    validate: validateTexturePipeline,
    guard: (pipeline) => {
      return shouldPlanOnly ? null : pipeline.guardRevision();
    },
    run: async (pipeline) =>
      await runTexturePipeline({
        deps,
        payload,
        pipeline,
        shouldPlanOnly,
        clarificationQuestions
      })
  });
};



