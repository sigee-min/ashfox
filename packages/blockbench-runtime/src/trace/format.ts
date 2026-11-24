import type {
  ProjectDiff,
  ProjectState,
  ToolError,
  ToolResponse,
} from '@ashfox/blockbench-contracts/types/internal';
import {
  TRACE_LOG_FINITE_JSON_ENVELOPE_DEPTH,
  type TraceLogDiffSummary,
  type TraceLogRecord,
  type TraceLogResponse,
  type TraceLogStateSummary,
} from '@ashfox/blockbench-contracts/types/traceLog';
import {
  FINITE_JSON_CONTRACT_MAX_CONTAINERS,
  FINITE_JSON_CONTRACT_MAX_DEPTH,
} from '@ashfox/internal-contracts';

/*
 * The bounded formatter is intentionally lossy, while the contract formatter
 * must retain the deepest value admitted by ProjectState/ProjectDiff inside a
 * trace record. Both share the finite-contract container budget so aliases
 * cannot turn a small resident DAG into an exponentially large snapshot.
 * Primitive values and their descriptors do not consume that authority;
 * otherwise a valid wide v1 state would be rejected before its container cap.
 */
/** Mutable budget state shared by bounded and contract-safe sanitizers. */
type SanitizerContext = {
  readonly ancestors: WeakSet<object>;
  readonly bounded: boolean;
  remainingContainers: number;
  exhausted: boolean;
};

type DescriptorRead = { ok: true; descriptor: PropertyDescriptor | undefined } | { ok: false };

const REDACT_KEYS = new Set(['dataUri', 'image', 'canvas', 'ctx', 'img']);
const MAX_DEPTH = 6;
const MAX_ARRAY = 50;
const MAX_OBJECT_KEYS = 100;
const MAX_CONTRACT_DEPTH = FINITE_JSON_CONTRACT_MAX_DEPTH + TRACE_LOG_FINITE_JSON_ENVELOPE_DEPTH;
const MAX_SANITIZER_CONTAINERS = FINITE_JSON_CONTRACT_MAX_CONTAINERS;
const TRUNCATED_KEYS_MARKER = '__ashfoxTruncatedKeys__';
const ACCESSOR_MARKER = '[accessor]';
const UNAVAILABLE_MARKER = '[unavailable]';

const spendContainer = (context: SanitizerContext): boolean => {
  if (context.remainingContainers <= 0) {
    context.exhausted = true;
    return false;
  }
  context.remainingContainers -= 1;
  return true;
};

const truncatedValue = (bounded: boolean): unknown => (bounded ? '[truncated]' : null);

const unavailableValue = (bounded: boolean): unknown => (bounded ? UNAVAILABLE_MARKER : null);

const accessorValue = (bounded: boolean): unknown => (bounded ? ACCESSOR_MARKER : null);

const ownsDescriptorValue = (
  descriptor: PropertyDescriptor,
): descriptor is PropertyDescriptor & { value: unknown } =>
  Object.prototype.hasOwnProperty.call(descriptor, 'value');

const readDescriptor = (value: object, key: PropertyKey): DescriptorRead => {
  try {
    return {
      ok: true,
      descriptor: Object.getOwnPropertyDescriptor(value, key),
    };
  } catch (_error) {
    return { ok: false };
  }
};

const ownKeys = (value: object): readonly PropertyKey[] | null => {
  try {
    return Reflect.ownKeys(value);
  } catch (_error) {
    return null;
  }
};

const arrayLength = (value: object): number | null => {
  const result = readDescriptor(value, 'length');
  if (!result.ok) return null;
  const descriptor = result.descriptor;
  if (
    !descriptor ||
    !ownsDescriptorValue(descriptor) ||
    !Number.isSafeInteger(descriptor.value) ||
    (descriptor.value as number) < 0
  ) {
    return null;
  }
  return descriptor.value as number;
};

const defineRecordValue = (record: Record<string, unknown>, key: string, value: unknown): void => {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
};

const sanitizeArray = (value: object, depth: number, context: SanitizerContext): unknown => {
  const length = arrayLength(value);
  if (length === null) {
    return unavailableValue(context.bounded);
  }

  const entryLimit = context.bounded ? Math.min(length, MAX_ARRAY) : length;
  const result: unknown[] = [];
  let containerTruncated = false;

  for (let index = 0; index < entryLimit; index += 1) {
    const descriptorResult = readDescriptor(value, String(index));
    if (!descriptorResult.ok) {
      return unavailableValue(context.bounded);
    }

    const descriptor = descriptorResult.descriptor;
    if (!descriptor) {
      result.push(null);
      continue;
    }
    if (!ownsDescriptorValue(descriptor)) {
      result.push(accessorValue(context.bounded));
      continue;
    }

    const sanitized = sanitizeValue(descriptor.value, depth + 1, context);
    if (!context.bounded && context.exhausted) return null;
    result.push(sanitized === undefined ? null : sanitized);
    if (context.exhausted) {
      containerTruncated = true;
      break;
    }
  }

  if (!context.bounded) return context.exhausted ? null : result;
  if (length > MAX_ARRAY || containerTruncated) result.push('[truncated]');
  return result;
};

const sanitizeRecord = (value: object, depth: number, context: SanitizerContext): unknown => {
  const keys = ownKeys(value);
  if (keys === null) return unavailableValue(context.bounded);

  const record: Record<string, unknown> = {};
  const keyLimit = context.bounded ? Math.min(keys.length, MAX_OBJECT_KEYS) : keys.length;
  let containerTruncated = false;

  for (let index = 0; index < keyLimit; index += 1) {
    const key = keys[index];
    if (typeof key !== 'string') continue;

    const descriptorResult = readDescriptor(value, key);
    if (!descriptorResult.ok) {
      return unavailableValue(context.bounded);
    }
    const descriptor = descriptorResult.descriptor;
    if (!descriptor?.enumerable) continue;

    if (REDACT_KEYS.has(key)) {
      defineRecordValue(record, key, '<redacted>');
      continue;
    }
    if (!ownsDescriptorValue(descriptor)) {
      defineRecordValue(record, key, accessorValue(context.bounded));
      continue;
    }

    const sanitized = sanitizeValue(descriptor.value, depth + 1, context);
    if (!context.bounded && context.exhausted) return null;
    if (sanitized !== undefined) defineRecordValue(record, key, sanitized);
    if (context.exhausted) {
      containerTruncated = true;
      break;
    }
  }

  if (!context.bounded) return context.exhausted ? null : record;
  if (containerTruncated) {
    defineRecordValue(record, TRUNCATED_KEYS_MARKER, '[truncated]');
  } else if (keys.length > keyLimit) {
    defineRecordValue(record, TRUNCATED_KEYS_MARKER, `[truncated:${keys.length - keyLimit}]`);
  }
  return record;
};

const sanitizeValue = (value: unknown, depth: number, context: SanitizerContext): unknown => {
  if (depth > (context.bounded ? MAX_DEPTH : MAX_CONTRACT_DEPTH)) {
    return truncatedValue(context.bounded);
  }
  if (value === null || value === undefined) return value;
  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'boolean') return value;
  if (valueType === 'number') {
    return Number.isFinite(value as number) ? value : null;
  }
  if (valueType === 'function') return '[function]';
  if (valueType !== 'object') return String(value);

  const objectValue = value as object;
  if (context.ancestors.has(objectValue)) return '[circular]';
  if (!spendContainer(context)) return truncatedValue(context.bounded);
  context.ancestors.add(objectValue);
  try {
    return Array.isArray(objectValue)
      ? sanitizeArray(objectValue, depth, context)
      : sanitizeRecord(objectValue, depth, context);
  } catch (_error) {
    return unavailableValue(context.bounded);
  } finally {
    context.ancestors.delete(objectValue);
  }
};

const createSanitizerContext = (bounded: boolean): SanitizerContext => ({
  ancestors: new WeakSet<object>(),
  bounded,
  remainingContainers: MAX_SANITIZER_CONTAINERS,
  exhausted: false,
});

const sanitizeWithMode = (value: unknown, bounded: boolean): unknown => {
  try {
    return sanitizeValue(value, 0, createSanitizerContext(bounded));
  } catch (_error) {
    return unavailableValue(bounded);
  }
};

export const sanitizeTraceValue = (value: unknown): unknown => sanitizeWithMode(value, true);

export const normalizeTraceContractValue = <T>(value: T): T => sanitizeWithMode(value, false) as T;

export const serializeTraceLogRecord = (record: TraceLogRecord): string => JSON.stringify(record);

/*
 * Keep the summaries below the sanitizer implementation: their typed inputs
 * are trusted domain snapshots and do not require reflective traversal.
 */
export const summarizeProjectState = (state: ProjectState): TraceLogStateSummary => ({
  id: state.id,
  revision: state.revision,
  name: state.name ?? null,
  format: state.format ?? null,
  ...(state.formatId !== undefined ? { formatId: state.formatId } : {}),
  ...(state.textureResolution ? { textureResolution: state.textureResolution } : {}),
  counts: state.counts,
});

export const summarizeProjectDiff = (diff: ProjectDiff): TraceLogDiffSummary => ({
  sinceRevision: diff.sinceRevision,
  currentRevision: diff.currentRevision,
  ...(diff.baseMissing !== undefined ? { baseMissing: diff.baseMissing } : {}),
  counts: diff.counts,
});

export const sanitizeToolError = (error: ToolError): ToolError => ({
  code: error.code,
  message: error.message,
  ...(error.fix ? { fix: error.fix } : {}),
  ...(error.details
    ? { details: sanitizeTraceValue(error.details) as Record<string, unknown> }
    : {}),
});

export const sanitizeToolResponse = (response: ToolResponse<unknown>): TraceLogResponse => {
  if (response.ok) {
    const data = sanitizeTraceValue(response.data);
    return { ok: true, ...(data !== undefined ? { data } : {}) };
  }
  return { ok: false, error: sanitizeToolError(response.error) };
};
