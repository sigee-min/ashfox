import type { AssetProject } from '../../project/asset';
import type { CommandBatch, CommandBatchResult, CommandSource } from '../types';
import { applyCommandOperation } from './applyOperation';
import { emptyCommandEffects, mergeCommandEffects } from './effects';
import { commandBatchFailure } from './failure';
import { validateCommandBatch } from './validate';
import { createCommandExecutionContext, type CommandExecutionContext } from './context';

export const executeCommandBatchPipeline = (
  project: AssetProject,
  batch: CommandBatch,
  source: CommandSource,
  context: CommandExecutionContext = createCommandExecutionContext(),
): CommandBatchResult => {
  const batchFailure = validateCommandBatch(project, batch, source);
  if (batchFailure) return batchFailure;

  let workingProject = project;
  let effects = emptyCommandEffects();
  const summaries: string[] = [];
  for (let index = 0; index < batch.operations.length; index += 1) {
    const applied = applyCommandOperation(workingProject, batch, index, source, context);
    if ('ok' in applied) return applied;
    workingProject = applied.project;
    effects = mergeCommandEffects(effects, applied.effects);
    summaries.push(applied.summary);
  }

  if (workingProject === project) {
    return commandBatchFailure(project, {
      code: 'no_change',
      message: 'Batch does not change the active asset project.',
    });
  }
  return {
    ok: true,
    project: workingProject,
    summary: summaries.join('; '),
    effects,
    findings: [],
  };
};
