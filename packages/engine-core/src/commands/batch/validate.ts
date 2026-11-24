import type { AssetProject } from '../../project/asset';
import { commandAllowedForSource, getCommandDefinition } from '../registry';
import type { CommandBatch, CommandBatchFailure, CommandSource } from '../types';
import { commandBatchFailure } from './failure';

const MAX_BATCH_OPERATIONS = 64;

export const validateCommandBatch = (
  project: AssetProject,
  batch: CommandBatch,
  source: CommandSource,
): CommandBatchFailure | null => {
  if (batch.batchId.trim().length === 0) {
    return commandBatchFailure(project, {
      code: 'invalid_batch',
      message: 'Batch ID is required.',
      path: 'batchId',
      expected: 'non-empty string',
    });
  }
  if (typeof batch.baseProjectId !== 'string' || batch.baseProjectId.trim().length === 0) {
    return commandBatchFailure(project, {
      code: 'invalid_batch',
      message: 'Base project ID is required.',
      path: 'baseProjectId',
      expected: 'non-empty string',
    });
  }
  if (batch.baseProjectId !== project.id) {
    return commandBatchFailure(project, {
      code: 'project_mismatch',
      message: 'Batch project does not match the active project.',
      path: 'baseProjectId',
      expected: project.id,
    });
  }
  if (batch.baseRevision !== project.revision) {
    return commandBatchFailure(project, {
      code: 'revision_mismatch',
      message: 'Batch revision does not match the active project.',
      path: 'baseRevision',
      expected: project.revision,
    });
  }
  if (source === 'agent' && batch.operations.length !== 1) {
    return commandBatchFailure(project, {
      code: 'invalid_batch',
      message: 'Agent batches must contain exactly one operation.',
      path: 'operations',
      expected: 'exactly one operation',
    });
  }
  if (batch.operations.length === 0 || batch.operations.length > MAX_BATCH_OPERATIONS) {
    return commandBatchFailure(project, {
      code: 'invalid_batch',
      message: 'Batch operation count is outside the allowed range.',
      path: 'operations',
      expected: `1-${MAX_BATCH_OPERATIONS} operations`,
    });
  }
  for (let index = 0; index < batch.operations.length; index += 1) {
    const operation = batch.operations[index];
    const definition = getCommandDefinition(operation.name);
    if (!definition) {
      return commandBatchFailure(project, {
        code: 'invalid_payload',
        message: `Command "${String(operation.name)}" is not registered.`,
        path: `operations[${index}].name`,
        expected: 'registered command name',
      });
    }
    if (!commandAllowedForSource(operation.name, source)) {
      return commandBatchFailure(project, {
        code: 'invalid_payload',
        message: `Command "${operation.name}" is not available to ${source}.`,
        path: `operations[${index}].name`,
        expected: 'command available to this trusted source',
      });
    }
    const issue = definition.validate(operation.payload);
    if (issue) {
      return commandBatchFailure(project, {
        code: 'invalid_payload',
        message: issue.message,
        path: `operations[${index}].payload${issue.path.slice(1)}`,
        expected: issue.expected,
      });
    }
  }
  return null;
};
