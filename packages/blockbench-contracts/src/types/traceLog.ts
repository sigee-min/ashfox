import {
  TRACE_LOG_SCHEMA_VERSION as CURRENT_TRACE_LOG_SCHEMA_VERSION,
  isCanonicalIsoDate,
  isClosedContractRecord,
  isFiniteJsonValue,
  isNonEmptyContractText,
  isUniqueContractTextArray,
} from '@ashfox/internal-contracts';

import type { ProjectDiff, ProjectDiffCountsByKind, ProjectState } from './project';
import {
  isProjectDiffContract,
  isProjectStateContract,
  isProjectStateCountsContract,
  isProjectTextureResolutionContract,
} from './project/contract';
import { FORMAT_KINDS, isToolErrorContract, type FormatKind, type ToolError } from './shared';

export type TraceLogRoute = 'tool';

export const TRACE_LOG_SCHEMA_VERSION = CURRENT_TRACE_LOG_SCHEMA_VERSION;

// The deepest finite-JSON leaf is a trigger value nested under a changed
// animation in ProjectDiff (record -> diff -> ... -> key -> value).
export const TRACE_LOG_FINITE_JSON_ENVELOPE_DEPTH = 10;

export type TraceLogHeader = {
  kind: 'header';
  schemaVersion: typeof TRACE_LOG_SCHEMA_VERSION;
  createdAt: string;
  pluginVersion?: string;
  blockbenchVersion?: string;
  notes?: string[];
};

export type TraceLogStateSummary = {
  id: string;
  revision: string;
  name: string | null;
  format: FormatKind | null;
  formatId?: string | null;
  textureResolution?: { width: number; height: number };
  counts: ProjectState['counts'];
};

export type TraceLogDiffSummary = {
  sinceRevision: string;
  currentRevision: string;
  baseMissing?: boolean;
  counts: ProjectDiffCountsByKind;
};

export type TraceLogResponse = { ok: true; data?: unknown } | { ok: false; error: ToolError };

export type TraceLogEntry = {
  kind: 'step';
  seq: number;
  ts: string;
  route: TraceLogRoute;
  op: string;
  payload?: unknown;
  response: TraceLogResponse;
  state?: TraceLogStateSummary | ProjectState;
  diff?: TraceLogDiffSummary | ProjectDiff;
  stateError?: ToolError;
  diffError?: ToolError;
};

export type TraceLogRecord = TraceLogHeader | TraceLogEntry;

export type TraceLogReportOpSummary = {
  count: number;
  errors: number;
};

export type TraceLogReport = {
  schemaVersion: typeof TRACE_LOG_SCHEMA_VERSION;
  generatedAt: string;
  steps: number;
  errors: number;
  routes: { tool: number };
  ops: Record<string, TraceLogReportOpSummary>;
  firstTs?: string;
  lastTs?: string;
  diffCounts?: ProjectDiff['counts'];
  lastError?: { seq: number; op: string; code: string; message: string };
  warnings?: string[];
};

type ContractRecord = Readonly<Record<string, unknown>>;

const owns = (value: ContractRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const hasShape = (
  value: ContractRecord,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean => {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => owns(value, key)) && Object.keys(value).every((key) => allowed.has(key))
  );
};

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isOptional = (
  value: ContractRecord,
  key: string,
  guard: (entry: unknown) => boolean,
): boolean => !owns(value, key) || guard(value[key]);

const isFormat = (value: unknown): value is FormatKind =>
  typeof value === 'string' && FORMAT_KINDS.includes(value as (typeof FORMAT_KINDS)[number]);

const isTraceLogResponse = (value: unknown): value is TraceLogResponse => {
  if (!isClosedContractRecord(value)) return false;
  if (value.ok === true) {
    return hasShape(value, ['ok'], ['data']) && isOptional(value, 'data', isFiniteJsonValue);
  }
  if (value.ok === false) {
    return hasShape(value, ['ok', 'error']) && isToolErrorContract(value.error);
  }
  return false;
};

const isTraceLogStateSummary = (value: unknown): value is TraceLogStateSummary => {
  if (
    !isClosedContractRecord(value) ||
    !hasShape(
      value,
      ['id', 'revision', 'name', 'format', 'counts'],
      ['formatId', 'textureResolution'],
    ) ||
    !isNonEmptyContractText(value.id) ||
    !isNonEmptyContractText(value.revision) ||
    !(value.name === null || typeof value.name === 'string') ||
    !(value.format === null || isFormat(value.format)) ||
    !isProjectStateCountsContract(value.counts)
  ) {
    return false;
  }
  return (
    isOptional(value, 'formatId', (entry) => entry === null || typeof entry === 'string') &&
    isOptional(value, 'textureResolution', isProjectTextureResolutionContract)
  );
};

const isTraceLogState = (value: unknown): value is TraceLogStateSummary | ProjectState =>
  isTraceLogStateSummary(value) || isProjectStateContract(value);

const isTraceLogDiff = (value: unknown): value is TraceLogDiffSummary | ProjectDiff =>
  isProjectDiffContract(value);

const hasCoherentObservationBranches = (value: ContractRecord): boolean => {
  const hasState = owns(value, 'state');
  const hasStateError = owns(value, 'stateError');
  const hasDiff = owns(value, 'diff');
  const hasDiffError = owns(value, 'diffError');
  if (
    hasState &&
    hasDiff &&
    isClosedContractRecord(value.state) &&
    isClosedContractRecord(value.diff) &&
    value.state.revision !== value.diff.currentRevision
  ) {
    return false;
  }
  return (
    !(hasState && hasStateError) &&
    !(hasDiff && hasDiffError) &&
    (!(hasDiff || hasDiffError) || hasState)
  );
};

export const isTraceLogHeader = (value: unknown): value is TraceLogHeader =>
  isClosedContractRecord(value) &&
  hasShape(
    value,
    ['kind', 'schemaVersion', 'createdAt'],
    ['pluginVersion', 'blockbenchVersion', 'notes'],
  ) &&
  value.kind === 'header' &&
  value.schemaVersion === TRACE_LOG_SCHEMA_VERSION &&
  isCanonicalIsoDate(value.createdAt) &&
  isOptional(value, 'pluginVersion', isNonEmptyContractText) &&
  isOptional(value, 'blockbenchVersion', isNonEmptyContractText) &&
  isOptional(value, 'notes', isUniqueContractTextArray);

export const isTraceLogEntry = (value: unknown): value is TraceLogEntry =>
  isClosedContractRecord(value) &&
  hasShape(
    value,
    ['kind', 'seq', 'ts', 'route', 'op', 'response'],
    ['payload', 'state', 'diff', 'stateError', 'diffError'],
  ) &&
  value.kind === 'step' &&
  isNonNegativeInteger(value.seq) &&
  value.seq > 0 &&
  isCanonicalIsoDate(value.ts) &&
  value.route === 'tool' &&
  isNonEmptyContractText(value.op) &&
  isTraceLogResponse(value.response) &&
  isOptional(value, 'payload', isFiniteJsonValue) &&
  isOptional(value, 'state', isTraceLogState) &&
  isOptional(value, 'diff', isTraceLogDiff) &&
  isOptional(value, 'stateError', isToolErrorContract) &&
  isOptional(value, 'diffError', isToolErrorContract) &&
  hasCoherentObservationBranches(value);

export const isTraceLogRecord = (value: unknown): value is TraceLogRecord =>
  isTraceLogHeader(value) || isTraceLogEntry(value);
