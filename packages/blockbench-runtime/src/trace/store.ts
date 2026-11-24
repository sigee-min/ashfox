import {
  isTraceLogRecord,
  TRACE_LOG_FINITE_JSON_ENVELOPE_DEPTH,
  type TraceLogRecord,
} from '@ashfox/blockbench-contracts/types/traceLog';
import type { TraceLogWriter } from '../ports/traceLog';
import type { ToolError } from '@ashfox/blockbench-contracts/types/internal';
import { createFiniteJsonSnapshot, utf8ContractByteLength } from '@ashfox/internal-contracts';
import { serializeTraceLogRecord } from './format';

export type TraceLogStoreOptions = {
  writer?: TraceLogWriter | null;
  autoFlush?: boolean;
  maxEntries?: number;
  maxBytes?: number;
  minEntries?: number;
};

export class TraceLogStore {
  private headerLine: string | null = null;
  private readonly stepLines: string[] = [];
  private stepStartIndex = 0;
  private stepsText = '';
  private writer?: TraceLogWriter | null;
  private autoFlush: boolean;
  private maxEntries: number;
  private maxBytes?: number;
  private minEntries: number;
  private currentSize = 0;
  private lastSeq = 0;

  constructor(options: TraceLogStoreOptions = {}) {
    this.writer = options.writer ?? null;
    this.autoFlush = options.autoFlush !== false;
    this.maxEntries = Number.isFinite(options.maxEntries)
      ? Math.max(1, Math.trunc(options.maxEntries as number))
      : 2000;
    this.maxBytes = normalizeMaxBytes(options.maxBytes);
    this.minEntries = normalizeMinEntries(options.minEntries);
  }

  append(record: TraceLogRecord): { text: string; error?: ToolError } {
    const snapshot = createFiniteJsonSnapshot(record, {
      depthAllowance: TRACE_LOG_FINITE_JSON_ENVELOPE_DEPTH,
    });
    if (!snapshot.ok || !isTraceLogRecord(snapshot.value)) {
      return {
        text: '',
        error: {
          code: 'invalid_state',
          message: 'Trace log record violates the current closed contract.',
          details: { reason: 'trace_log_record_invalid' },
        },
      };
    }
    const acceptedRecord = snapshot.value;
    const text = serializeTraceLogRecord(acceptedRecord);
    if (acceptedRecord.kind === 'header') {
      if (this.headerLine !== null) {
        return ledgerError(
          'trace_log_header_duplicated',
          'Trace log ledger already contains its v1 header.',
        );
      }
      this.headerLine = text;
    } else {
      if (this.headerLine === null) {
        return ledgerError(
          'trace_log_header_required',
          'Trace log ledger requires a v1 header before its first step.',
        );
      }
      if (acceptedRecord.seq <= this.lastSeq) {
        return ledgerError(
          'trace_log_sequence_invalid',
          `Trace log step sequence ${acceptedRecord.seq} must be greater than ${this.lastSeq}.`,
        );
      }
      this.stepLines.push(text);
      this.stepsText += `${text}\n`;
      this.lastSeq = acceptedRecord.seq;
    }
    this.currentSize += utf8ContractByteLength(text) + 1;
    this.trim();
    let error: ToolError | undefined;
    if (this.autoFlush && this.writer) {
      const result = writeTraceLog(this.writer, this.getText());
      if (result) error = result;
    }
    return { text, ...(error ? { error } : {}) };
  }

  flush(writerOverride?: TraceLogWriter | null): ToolError | null {
    const writer = writerOverride ?? this.writer;
    if (!writer) return null;
    return writeTraceLog(writer, this.getText());
  }

  clear(): void {
    this.headerLine = null;
    this.stepLines.length = 0;
    this.stepStartIndex = 0;
    this.stepsText = '';
    this.currentSize = 0;
    this.lastSeq = 0;
  }

  size(): number {
    return (this.headerLine === null ? 0 : 1) + this.stepCount();
  }

  update(options: TraceLogStoreOptions): void {
    if (options.writer !== undefined) this.writer = options.writer;
    if (options.autoFlush !== undefined) this.autoFlush = options.autoFlush !== false;
    if (options.maxEntries !== undefined && Number.isFinite(options.maxEntries)) {
      this.maxEntries = Math.max(1, Math.trunc(options.maxEntries));
    }
    if (options.maxBytes !== undefined) {
      this.maxBytes = normalizeMaxBytes(options.maxBytes);
    }
    if (options.minEntries !== undefined) {
      this.minEntries = normalizeMinEntries(options.minEntries);
    }
    this.trim();
  }

  getText(): string {
    if (this.headerLine === null) return '';
    return `${this.headerLine}\n${this.stepsText}`;
  }

  private trim(): void {
    while (this.size() > this.maxEntries && this.stepCount() > 0) {
      this.dropOldestStep();
    }
    if (this.maxBytes && this.maxBytes > 0) {
      const retainedFloor =
        this.headerLine === null ? this.minEntries : Math.max(1, this.minEntries);
      while (
        this.currentSize > this.maxBytes &&
        this.size() > retainedFloor &&
        this.stepCount() > 0
      ) {
        this.dropOldestStep();
      }
    }
    if (this.size() === 0) {
      this.currentSize = 0;
      this.stepsText = '';
      this.stepStartIndex = 0;
      this.stepLines.length = 0;
    }
  }

  private stepCount(): number {
    return Math.max(0, this.stepLines.length - this.stepStartIndex);
  }

  private dropOldestStep(): void {
    const removed = this.stepLines[this.stepStartIndex];
    if (removed === undefined) return;
    this.stepStartIndex += 1;
    if (removed) {
      this.currentSize -= utf8ContractByteLength(removed) + 1;
      if (this.currentSize < 0) this.currentSize = 0;
      const dropLength = removed.length + 1;
      if (this.stepsText.length <= dropLength) {
        this.stepsText = '';
      } else {
        this.stepsText = this.stepsText.slice(dropLength);
      }
    }
    if (this.stepStartIndex > 1000 && this.stepStartIndex > this.stepLines.length / 2) {
      this.stepLines.splice(0, this.stepStartIndex);
      this.stepStartIndex = 0;
    }
  }
}

const ledgerError = (reason: string, message: string): { text: string; error: ToolError } => ({
  text: '',
  error: {
    code: 'invalid_state',
    message,
    details: { reason },
  },
});

const writeTraceLog = (writer: TraceLogWriter, text: string): ToolError | null => {
  try {
    return writer.write(text);
  } catch (_error) {
    return {
      code: 'io_error',
      message: 'Trace log writer threw while persisting the accepted ledger.',
      details: { reason: 'trace_log_writer_threw' },
    };
  }
};

const normalizeMaxBytes = (value?: number): number | undefined => {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) return undefined;
  const normalized = Math.max(0, Math.trunc(value));
  return normalized > 0 ? normalized : undefined;
};

const normalizeMinEntries = (value?: number): number => {
  if (value === undefined) return 1;
  if (!Number.isFinite(value)) return 1;
  const normalized = Math.max(0, Math.trunc(value));
  return normalized;
};
