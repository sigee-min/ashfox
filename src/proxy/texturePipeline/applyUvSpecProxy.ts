import type { ApplyUvSpecPayload } from '../../spec';
import type { ToolResponse } from '../../types';
import { buildUvRefreshNextActions } from '../nextActionHelpers';
import { validateUvSpec } from '../validators';
import type { ProxyPipelineDeps } from '../types';
import { applyUvAssignments } from '../uvApplyStep';
import type { ApplyUvSpecResult } from './types';
import { runProxyPipeline } from '../pipelineRunner';

export const applyUvSpecProxy = async (
  deps: ProxyPipelineDeps,
  payload: ApplyUvSpecPayload
): Promise<ToolResponse<ApplyUvSpecResult>> => {
  return runProxyPipeline<ApplyUvSpecPayload, ApplyUvSpecResult>(deps, payload, {
    validate: (payloadValue) => validateUvSpec(payloadValue),
    run: async (pipeline) => {
      const uvRes = applyUvAssignments(deps, pipeline.meta, {
        assignments: payload.assignments,
        uvUsageId: payload.uvUsageId,
        ifRevision: payload.ifRevision
      });
      if (!uvRes.ok) return uvRes;
      const result: ApplyUvSpecResult = {
        applied: true,
        cubes: uvRes.data.cubeCount,
        faces: uvRes.data.faceCount,
        uvUsageId: uvRes.data.uvUsageId
      };
      const response = pipeline.ok(result);
      return {
        ...response,
        nextActions: buildUvRefreshNextActions(
          'UVs changed. Refresh uvUsageId before painting textures.',
          1
        )
      };
    }
  });
};



