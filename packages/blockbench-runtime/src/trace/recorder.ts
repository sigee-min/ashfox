import type {
  ProjectDiff,
  ProjectState,
  ProjectStateDetail,
  ToolError,
  ToolResponse,
} from '@ashfox/blockbench-contracts/types/internal';
import {
  TRACE_LOG_SCHEMA_VERSION,
  type TraceLogEntry,
  type TraceLogHeader,
} from '@ashfox/blockbench-contracts/types/traceLog';
import type { UsecaseResult } from '../usecases/result';
import {
  normalizeTraceContractValue,
  sanitizeToolError,
  sanitizeToolResponse,
  sanitizeTraceValue,
  summarizeProjectDiff,
  summarizeProjectState,
} from './format';
import { TraceLogStore } from './store';
import type { TraceLogWriter } from '../ports/traceLog';

export type TraceRecorderDeps = {
  getProjectState: (payload: {
    detail: ProjectStateDetail;
    includeUsage?: boolean;
  }) => UsecaseResult<{ project: ProjectState }>;
  getProjectDiff: (payload: {
    sinceRevision: string;
    detail?: ProjectStateDetail;
  }) => UsecaseResult<{ diff: ProjectDiff }>;
};

export type TraceRecorderOptions = {
  enabled?: boolean;
  includeState?: boolean;
  includeDiff?: boolean;
  stateDetail?: ProjectStateDetail;
  diffDetail?: ProjectStateDetail;
  includeUsage?: boolean;
  pluginVersion?: string;
  blockbenchVersion?: string;
  detailRules?: TraceLogDetailRule[];
  onRecord?: () => void;
};

export type TraceLogDetailRule = {
  ops: string[];
  includeState?: boolean;
  includeDiff?: boolean;
  includeUsage?: boolean;
  stateDetail?: ProjectStateDetail;
  diffDetail?: ProjectStateDetail;
};

export class TraceRecorder {
  private readonly deps: TraceRecorderDeps;
  private readonly store: TraceLogStore;
  private enabled: boolean;
  private includeState: boolean;
  private includeDiff: boolean;
  private stateDetail: ProjectStateDetail;
  private diffDetail: ProjectStateDetail;
  private includeUsage: boolean;
  private pluginVersion?: string;
  private blockbenchVersion?: string;
  private detailRules: TraceLogDetailRule[];
  private onRecord?: () => void;
  private seq = 0;
  private lastRevision: string | null = null;
  private headerWritten = false;

  constructor(deps: TraceRecorderDeps, store: TraceLogStore, options: TraceRecorderOptions = {}) {
    this.deps = deps;
    this.store = store;
    this.enabled = options.enabled !== false;
    this.includeState = options.includeState !== false;
    this.includeDiff = options.includeDiff !== false;
    this.stateDetail = options.stateDetail ?? 'summary';
    this.diffDetail = options.diffDetail ?? 'summary';
    this.includeUsage = options.includeUsage === true;
    this.pluginVersion = options.pluginVersion;
    this.blockbenchVersion = options.blockbenchVersion;
    this.detailRules = options.detailRules ?? [];
    this.onRecord = options.onRecord;
  }

  update(options: Partial<TraceRecorderOptions>): void {
    if (options.enabled !== undefined) this.enabled = options.enabled;
    if (options.includeState !== undefined) this.includeState = options.includeState;
    if (options.includeDiff !== undefined) this.includeDiff = options.includeDiff;
    if (options.stateDetail) this.stateDetail = options.stateDetail;
    if (options.diffDetail) this.diffDetail = options.diffDetail;
    if (options.includeUsage !== undefined) this.includeUsage = options.includeUsage;
    if (options.pluginVersion !== undefined) this.pluginVersion = options.pluginVersion;
    if (options.blockbenchVersion !== undefined) this.blockbenchVersion = options.blockbenchVersion;
    if (options.detailRules !== undefined) this.detailRules = options.detailRules;
    if (options.onRecord !== undefined) this.onRecord = options.onRecord;
  }

  record(op: string, payload: unknown, response: ToolResponse<unknown>): ToolError | null {
    if (!this.enabled) return null;
    let writeError: ToolError | null = null;
    if (!this.headerWritten) {
      const header = this.buildHeader();
      const appended = this.store.append(header);
      if (!appended.text) {
        return (
          appended.error ?? {
            code: 'invalid_state',
            message: 'Trace log header was not accepted.',
          }
        );
      }
      this.headerWritten = true;
      writeError = appended.error ?? null;
    }

    const sanitizedPayload = sanitizeTraceValue(payload);
    const nextSeq = this.seq + 1;
    const entry: TraceLogEntry = {
      kind: 'step',
      seq: nextSeq,
      ts: new Date().toISOString(),
      route: 'tool',
      op,
      ...(sanitizedPayload !== undefined ? { payload: sanitizedPayload } : {}),
      response: sanitizeToolResponse(response),
    };

    const detail = this.resolveDetail(op);
    const includeState = detail.includeState ?? this.includeState;
    const includeDiff = detail.includeDiff ?? this.includeDiff;
    const stateDetail = detail.stateDetail ?? this.stateDetail;
    const diffDetail = detail.diffDetail ?? this.diffDetail;
    const includeUsage = detail.includeUsage ?? this.includeUsage;

    const previousRevision = this.lastRevision;
    let nextRevision = previousRevision;
    const stateResult = includeState ? this.readState(stateDetail, includeUsage) : null;
    if (stateResult?.ok) {
      entry.state =
        stateDetail === 'full'
          ? normalizeTraceContractValue(stateResult.state)
          : summarizeProjectState(stateResult.state);
      nextRevision = stateResult.state.revision;
    } else if (stateResult && !stateResult.ok) {
      entry.stateError = sanitizeToolError(stateResult.error);
    }

    if (
      includeDiff &&
      previousRevision &&
      stateResult?.ok &&
      previousRevision !== stateResult.state.revision
    ) {
      const diffResult = this.readDiff(previousRevision, diffDetail);
      if (diffResult.ok) {
        if (diffResult.diff.currentRevision === stateResult.state.revision) {
          entry.diff =
            diffDetail === 'full'
              ? normalizeTraceContractValue(diffResult.diff)
              : summarizeProjectDiff(diffResult.diff);
        } else {
          entry.diffError = {
            code: 'invalid_state',
            message: 'Project changed while collecting trace observations.',
            details: { reason: 'trace_log_observation_revision_changed' },
          };
        }
      } else {
        entry.diffError = sanitizeToolError(diffResult.error);
      }
    }

    const appended = this.store.append(entry);
    if (!appended.text) {
      return (
        appended.error ?? {
          code: 'invalid_state',
          message: 'Trace log step was not accepted.',
        }
      );
    }
    this.seq = nextSeq;
    this.lastRevision = nextRevision;
    this.onRecord?.();
    return appended.error ?? writeError;
  }

  flush(): ToolError | null {
    return this.store.flush();
  }

  flushTo(writer?: TraceLogWriter | null): ToolError | null {
    return this.store.flush(writer ?? null);
  }

  getText(): string {
    return this.store.getText();
  }

  private readState(
    detail: ProjectStateDetail,
    includeUsage: boolean,
  ): { ok: true; state: ProjectState } | { ok: false; error: ToolError } {
    const result = this.deps.getProjectState({ detail, includeUsage });
    if (result.ok) return { ok: true, state: result.value.project };
    return { ok: false, error: result.error };
  }

  private readDiff(
    sinceRevision: string,
    detail: ProjectStateDetail,
  ): { ok: true; diff: ProjectDiff } | { ok: false; error: ToolError } {
    const result = this.deps.getProjectDiff({ sinceRevision, detail });
    if (result.ok) return { ok: true, diff: result.value.diff };
    return { ok: false, error: result.error };
  }

  private buildHeader(): TraceLogHeader {
    const detailUsage = this.detailRules.some((rule) => rule.includeUsage === true);
    return {
      kind: 'header',
      schemaVersion: TRACE_LOG_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      ...(this.pluginVersion ? { pluginVersion: this.pluginVersion } : {}),
      ...(this.blockbenchVersion ? { blockbenchVersion: this.blockbenchVersion } : {}),
      ...(this.includeUsage || detailUsage ? { notes: ['state includes textureUsage'] } : {}),
    };
  }

  private resolveDetail(op: string): Partial<TraceLogDetailRule> {
    for (const rule of this.detailRules) {
      if (rule.ops.includes(op)) return rule;
    }
    return {};
  }
}
