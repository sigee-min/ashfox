import type { TexturePipelinePayload } from '../../../spec';
import type { ToolResponse } from '../../../types';
import type { TexturePipelineContext } from './context';
import { runPipelineBatch } from './batch';
import { isResponseError } from '../../../shared/tooling/responseGuards';

export const runAssignStep = (
  ctx: TexturePipelineContext,
  entries: NonNullable<TexturePipelinePayload['assign']>,
  ifRevision?: string
): ToolResponse<void> => {
  const batch = ctx.deps.service.runWithoutRevisionGuard(() =>
    runPipelineBatch(entries, (entry) =>
      ctx.pipeline.wrap(
        ctx.deps.service.assignTexture({
          textureId: entry.textureId,
          textureName: entry.textureName,
          cubeIds: entry.cubeIds,
          cubeNames: entry.cubeNames,
          faces: entry.faces,
          ifRevision
        })
      )
    )
  );
  if (isResponseError(batch)) return batch;
  const results = batch.data;
  ctx.steps.assign = { applied: results.length, results };
  return { ok: true, data: undefined };
};

