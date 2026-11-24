import { COMMAND_RECEIPT_SCHEMA_VERSION as CURRENT_COMMAND_RECEIPT_SCHEMA_VERSION } from '@ashfox/internal-contracts';

import type { EntityId } from '../model';
import type { AssetProject } from '../project/asset';
import type { WorkspaceChangeSet, WorkspaceEntrySelector } from '../project/workspace';
import type { InvariantFinding } from '../validation';

export const COMMAND_RECEIPT_SCHEMA_VERSION = CURRENT_COMMAND_RECEIPT_SCHEMA_VERSION;

export const COMMAND_SOURCES = ['web', 'agent', 'import', 'system'] as const;
export type CommandSource = (typeof COMMAND_SOURCES)[number];

/** One explicit entry selection and one complete workspace change set. */
export interface WorkspaceApplyInput {
  readonly entry: WorkspaceEntrySelector;
  readonly changes: WorkspaceChangeSet;
}

/**
 * The complete mutation surface. Geometry, materials, and animation are
 * compiler output, never commands that a caller can issue.
 */
export interface CommandPayloadMap {
  'workspace.apply': WorkspaceApplyInput;
}

export type CommandName = keyof CommandPayloadMap;

export type ProjectCommandOperation = {
  [TName in CommandName]: {
    name: TName;
    payload: CommandPayloadMap[TName];
  };
}[CommandName];

export interface CommandBatch {
  batchId: string;
  baseProjectId: AssetProject['id'];
  baseRevision: AssetProject['revision'];
  operations: readonly ProjectCommandOperation[];
}

export const COMMAND_INVALIDATED_AREAS = [
  'scene',
  'textures',
  'uv',
  'animations',
  'validation',
  'preview',
] as const;
export type InvalidatedArea = (typeof COMMAND_INVALIDATED_AREAS)[number];

export interface CommandEffects {
  createdEntityIds: readonly EntityId[];
  changedEntityIds: readonly EntityId[];
  removedEntityIds: readonly EntityId[];
  invalidated: readonly InvalidatedArea[];
}

export interface CommandReceipt {
  schemaVersion: typeof COMMAND_RECEIPT_SCHEMA_VERSION;
  commandId: string;
  projectId: AssetProject['id'];
  actorId: string;
  source: CommandSource;
  summary: string;
  beforeRevision: AssetProject['revision'];
  revision: AssetProject['revision'];
  completedAt: string;
  durationMs: number;
  effects: CommandEffects;
  findings: readonly InvariantFinding[];
}

export type CommandErrorCode =
  | 'invalid_batch'
  | 'invalid_payload'
  | 'invalid_state'
  | 'project_mismatch'
  | 'revision_mismatch'
  | 'no_change';

export interface CommandError {
  code: CommandErrorCode;
  message: string;
  path?: string;
  expected?: string;
}

export interface CommandBatchSuccess {
  ok: true;
  project: AssetProject;
  summary: string;
  effects: CommandEffects;
  findings: readonly InvariantFinding[];
}

export interface CommandBatchFailure {
  ok: false;
  currentRevision: AssetProject['revision'];
  error: CommandError;
  findings?: readonly InvariantFinding[];
}

export type CommandBatchResult = CommandBatchSuccess | CommandBatchFailure;
