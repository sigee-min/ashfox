import {
  isTraceLogEntry,
  isTraceLogHeader,
  TRACE_LOG_SCHEMA_VERSION,
  type TraceLogRecord,
} from '@ashfox/blockbench-contracts/types/traceLog';
import { toolError } from '../shared/tooling/toolResponse';
import type { ToolError } from '@ashfox/blockbench-contracts/types/internal';

/** Closed result returned when parsing an NDJSON trace. */
export type TraceLogParseResult =
  | { ok: true; records: TraceLogRecord[]; warnings?: string[] }
  | { ok: false; error: ToolError; warnings?: string[] };

const invalidHeader = (warnings: readonly string[]): TraceLogParseResult => ({
  ok: false,
  error: toolError('invalid_payload', 'Trace log requires a v1 header.', {
    reason: 'trace_log_header_invalid',
  }),
  ...(warnings.length > 0 ? { warnings: [...warnings] } : {}),
});

export const parseTraceLogText = (text: string): TraceLogParseResult => {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const records: TraceLogRecord[] = [];
  const warnings: string[] = [];
  let lastSeq = 0;

  if (lines.length === 0) return invalidHeader(warnings);
  try {
    const header: unknown = JSON.parse(lines[0]);
    if (!isTraceLogHeader(header)) {
      warnings.push(`Line 1: trace schema must be v${TRACE_LOG_SCHEMA_VERSION}.`);
      return invalidHeader(warnings);
    }
    records.push(header);
  } catch (_error) {
    warnings.push('Line 1: invalid JSON header.');
    return invalidHeader(warnings);
  }

  lines.slice(1).forEach((line, offset) => {
    const index = offset + 1;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== 'object') {
        warnings.push(`Line ${index + 1}: not an object.`);
        return;
      }
      if (!('kind' in parsed) || (parsed.kind !== 'header' && parsed.kind !== 'step')) {
        warnings.push(`Line ${index + 1}: unknown record kind.`);
        return;
      }
      if (parsed.kind === 'header') {
        warnings.push(`Line ${index + 1}: duplicate trace header ignored.`);
        return;
      }
      if (!isTraceLogEntry(parsed)) {
        warnings.push(`Line ${index + 1}: invalid closed trace step ignored.`);
        return;
      }
      if (parsed.seq <= lastSeq) {
        warnings.push(`Line ${index + 1}: non-increasing trace sequence ignored.`);
        return;
      }
      if (lastSeq > 0 && parsed.seq > lastSeq + 1) {
        warnings.push(`Line ${index + 1}: trace sequence gap after ${lastSeq}.`);
      }
      lastSeq = parsed.seq;
      records.push(parsed);
    } catch (err) {
      warnings.push(`Line ${index + 1}: invalid JSON.`);
    }
  });

  return { ok: true, records, ...(warnings.length > 0 ? { warnings } : {}) };
};
