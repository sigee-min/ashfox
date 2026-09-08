import { applyWorkspaceChangeSet } from '../../compiler/program/asset/workspaceChange';
import type { AssetProject } from '../../project/asset';
import { openAssetProject } from '../../projectFile/workspace/open';
import type { WorkspaceDiagnostic } from '../../project/workspace/diagnostic';
import { defineCommand } from '../definition';
import type { CommandInputSchema } from '../schema';
import type { WorkspaceApplyInput } from '../types';

const opaqueObjectSchema: CommandInputSchema = {
  type: 'object',
  properties: {},
  additionalProperties: true
};

/** The command closes the envelope while the workspace stage owns deep rules. */
const inputSchema: CommandInputSchema = {
  type: 'object',
  properties: {
    entry: {
      type: 'object',
      properties: {
        packageName: { type: 'string', minLength: 1 },
        entryName: {
          type: 'string',
          minLength: 1,
          pattern: '^[A-Za-z_][A-Za-z0-9_]*$'
        }
      },
      required: ['packageName', 'entryName'],
      additionalProperties: false
    },
    changes: {
      type: 'object',
      properties: {
        expectedWorkspaceHash: {
          type: 'string',
          pattern: '^sha256:[0-9a-f]{64}$'
        },
        writes: {
          type: 'array',
          items: opaqueObjectSchema
        },
        deletes: {
          type: 'array',
          items: opaqueObjectSchema
        },
        manifest: opaqueObjectSchema,
      },
      required: ['expectedWorkspaceHash', 'writes', 'deletes'],
      additionalProperties: false
    }
  },
  required: ['entry', 'changes'],
  additionalProperties: false
};

const sameEntry = (
  left: AssetProject['entry'],
  right: AssetProject['entry']
): boolean => left.packageName === right.packageName &&
  left.entryName === right.entryName;

const diagnosticPath = (
  diagnostic: WorkspaceDiagnostic | undefined,
  fallback: string
): string => {
  const source = diagnostic?.source;
  if (source === undefined) return fallback;
  const packagePrefix = source.packageName === null
    ? ''
    : `${source.packageName}:`;
  return `${fallback}:${packagePrefix}${source.path}:${source.start.line}:${source.start.column}`;
};

const diagnosticFailure = (
  diagnostics: readonly WorkspaceDiagnostic[],
  fallback: string
) => {
  const first = diagnostics[0];
  return {
    ok: false as const,
    error: {
      code: 'invalid_state' as const,
      message: first?.message ?? 'Workspace change could not be compiled.',
      path: diagnosticPath(first, fallback)
    }
  };
};

/** Stage, compile, and return one immutable selected asset project. */
export const applyWorkspaceCommand = defineCommand({
  name: 'workspace.apply',
  label: 'Apply workspace change',
  purpose: 'Atomically stage a workspace change and compile one selected entry.',
  inputSchema,
  apply: (project, payload: WorkspaceApplyInput) => {
    const staged = applyWorkspaceChangeSet(project.workspace, payload.changes);
    if (!staged.ok) return diagnosticFailure(staged.diagnostics, 'payload.changes');

    if (staged.workspaceHash === project.build.workspaceHash &&
        sameEntry(project.entry, payload.entry)) {
      return {
        ok: false as const,
        error: {
          code: 'no_change' as const,
          message: 'Workspace change does not change the selected asset project.',
          path: 'payload.changes'
        }
      };
    }

    const opened = openAssetProject({
      workspace: staged.workspace,
      entry: payload.entry,
      identity: {
        id: project.id,
        revision: project.revision,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt
      }
    });
    if (!opened.ok) return diagnosticFailure(opened.diagnostics, 'payload.entry');
    return {
      ok: true as const,
      value: {
        project: opened.project,
        summary: `Apply workspace ${payload.entry.packageName}:${payload.entry.entryName}`,
        effects: {
          createdEntityIds: [],
          changedEntityIds: [project.id],
          removedEntityIds: [],
          invalidated: [
            'scene',
            'textures',
            'uv',
            'animations',
            'validation',
            'preview'
          ]
        }
      }
    };
  }
});
