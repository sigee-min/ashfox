import type { AssetProject } from '../../project/asset';
import type { CommandBatchFailure } from '../types';

export const commandBatchFailure = (
  project: AssetProject,
  error: CommandBatchFailure['error'],
  findings?: CommandBatchFailure['findings'],
): CommandBatchFailure => ({
  ok: false,
  currentRevision: project.revision,
  error,
  ...(findings ? { findings } : {}),
});
