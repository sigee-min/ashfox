import type { AssetProject } from '../project/asset';
import { validateCommandInput, type CommandInputSchema, type SchemaIssue } from './schema';
import type { CommandEffects, CommandError, CommandName, CommandPayloadMap } from './types';
import type { CommandExecutionContext } from './batch/context';

export type CommandApplicationError = CommandError;

export interface CommandApplication {
  project: AssetProject;
  summary: string;
  effects: CommandEffects;
}

export type CommandApplicationResult =
  | {
      ok: true;
      value: CommandApplication;
    }
  | {
      ok: false;
      error: CommandApplicationError;
    };

export interface CommandDefinition {
  name: CommandName;
  label: string;
  purpose: string;
  inputSchema: CommandInputSchema;
  validate: (payload: unknown) => SchemaIssue | null;
  apply: (
    project: AssetProject,
    payload: unknown,
    context?: CommandExecutionContext,
  ) => CommandApplicationResult;
}

interface CommandDefinitionSpec<TName extends CommandName> {
  name: TName;
  label: string;
  purpose: string;
  inputSchema: CommandInputSchema;
  apply: (
    project: AssetProject,
    payload: CommandPayloadMap[TName],
    context?: CommandExecutionContext,
  ) => CommandApplicationResult;
}

export const defineCommand = <TName extends CommandName>(
  spec: CommandDefinitionSpec<TName>,
): CommandDefinition => {
  const validate = (payload: unknown): SchemaIssue | null =>
    validateCommandInput(payload, spec.inputSchema);

  return {
    name: spec.name,
    label: spec.label,
    purpose: spec.purpose,
    inputSchema: spec.inputSchema,
    validate,
    apply: (project, payload, context) => {
      const issue = validate(payload);
      if (issue) {
        return {
          ok: false,
          error: {
            code: 'invalid_payload',
            message: issue.message,
            path: issue.path,
            expected: issue.expected,
          },
        };
      }
      return spec.apply(project, payload as CommandPayloadMap[TName], context);
    },
  };
};
