import type { AssetProject } from '../project/asset';
import { commandBatchFailure } from './batch/failure';
import { executeCommandBatchPipeline } from './batch/executePipeline';
import type { CommandBatch, CommandBatchResult, CommandSource } from './types';

const executeCommandBatch = (
  project: AssetProject,
  batch: CommandBatch,
  source: CommandSource,
): CommandBatchResult => {
  try {
    return executeCommandBatchPipeline(structuredClone(project), structuredClone(batch), source);
  } catch (error) {
    return commandBatchFailure(project, {
      code: 'invalid_state',
      message:
        error instanceof Error
          ? `Command batch terminated without changes: ${error.message}`
          : 'Command batch terminated without changes.',
    });
  }
};

export const executeAgentCommandBatch = (
  project: AssetProject,
  batch: CommandBatch,
): CommandBatchResult => executeCommandBatch(project, batch, 'agent');

export const executeWebCommandBatch = (
  project: AssetProject,
  batch: CommandBatch,
): CommandBatchResult => executeCommandBatch(project, batch, 'web');

export const executeSystemCommandBatch = (
  project: AssetProject,
  batch: CommandBatch,
): CommandBatchResult => executeCommandBatch(project, batch, 'system');
