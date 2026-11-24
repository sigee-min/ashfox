import type { AssetProject } from '../../project/asset';
import type { CommandApplication } from '../definition';
import { getCommandDefinition } from '../registry';
import type { CommandBatch, CommandBatchFailure, CommandSource } from '../types';
import { commandBatchFailure } from './failure';
import type { CommandExecutionContext } from './context';

export const applyCommandOperation = (
  project: AssetProject,
  batch: CommandBatch,
  index: number,
  _source: CommandSource,
  context: CommandExecutionContext,
): CommandApplication | CommandBatchFailure => {
  const operation = batch.operations[index];
  const definition = getCommandDefinition(operation.name);
  if (!definition) {
    return commandBatchFailure(project, {
      code: 'invalid_payload',
      message: `Command "${String(operation.name)}" is not registered.`,
      path: `operations[${index}].name`,
    });
  }
  const result = definition.apply(project, operation.payload, context);
  if (result.ok) return result.value;
  return commandBatchFailure(project, {
    ...result.error,
    path: result.error.path ? `operations[${index}].${result.error.path}` : `operations[${index}]`,
  });
};
