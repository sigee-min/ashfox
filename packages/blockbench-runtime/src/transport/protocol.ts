import {
  createFiniteJsonSnapshot,
  hasExactContractKeys,
  isClosedContractRecord,
  isDenseContractArray,
  isFiniteJsonValue,
  isNonEmptyContractText,
  SIDECAR_IPC_SCHEMA_VERSION,
} from '@ashfox/internal-contracts';

import {
  TOOL_NAMES,
  TOOL_RESPONSE_EXTENSION_LIMITS,
  isMcpContentBlockContract,
  isNextActionContract,
  isToolErrorContract,
  type McpContentBlock,
  type NextAction,
  type ToolError,
  type ToolName,
  type ToolPayloadMap,
} from '@ashfox/blockbench-contracts/types/internal';
import { toolSchemas } from '@ashfox/blockbench-contracts/mcpSchemas/toolSchemas';
import { validateSchema } from '@ashfox/blockbench-contracts/mcpSchemas/validation';

export const PROTOCOL_VERSION = SIDECAR_IPC_SCHEMA_VERSION;

export type SidecarRole = 'plugin' | 'sidecar';

export type SidecarHelloMessage = {
  type: 'hello';
  version: typeof PROTOCOL_VERSION;
  role: SidecarRole;
  ts: number;
};

export type SidecarReadyMessage = {
  type: 'ready';
  version: typeof PROTOCOL_VERSION;
  ts: number;
};

export type SidecarRequestMessage = {
  [TName in ToolName]: {
    type: 'request';
    id: string;
    ts: number;
    tool: TName;
    payload: ToolPayloadMap[TName];
  };
}[ToolName];

type SidecarResponseBase = {
  type: 'response';
  id: string;
  ts: number;
  content?: McpContentBlock[];
  structuredContent?: unknown;
  nextActions?: NextAction[];
};

export type SidecarResponseMessage = SidecarResponseBase &
  (
    | {
        ok: true;
        data: unknown;
      }
    | {
        ok: false;
        error: ToolError;
      }
  );

export type SidecarErrorMessage = {
  type: 'error';
  ts: number;
  id?: string;
  message: string;
  details?: Record<string, unknown>;
};

export type SidecarMessage =
  | SidecarHelloMessage
  | SidecarReadyMessage
  | SidecarRequestMessage
  | SidecarResponseMessage
  | SidecarErrorMessage;

export const normalizeSidecarMessage = (value: unknown): SidecarMessage | null => {
  try {
    const normalized = createFiniteJsonSnapshot(value, {
      depthAllowance: 2,
      omitUndefinedObjectProperties: true,
    });
    return normalized.ok && isSidecarMessage(normalized.value) ? normalized.value : null;
  } catch (_error) {
    return null;
  }
};

const HELLO_KEYS = new Set(['type', 'version', 'role', 'ts']);
const READY_KEYS = new Set(['type', 'version', 'ts']);
const REQUEST_KEYS = new Set(['type', 'id', 'ts', 'tool', 'payload']);
const RESPONSE_SUCCESS_KEYS = new Set([
  'type',
  'id',
  'ts',
  'ok',
  'data',
  'content',
  'structuredContent',
  'nextActions',
]);
const RESPONSE_FAILURE_KEYS = new Set([
  'type',
  'id',
  'ts',
  'ok',
  'error',
  'content',
  'structuredContent',
  'nextActions',
]);
const ERROR_MESSAGE_KEYS = new Set(['type', 'ts', 'id', 'message', 'details']);
const TOOL_NAME_SET = new Set<string>(TOOL_NAMES);
const owns = (value: Readonly<Record<string, unknown>>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const hasOnlyKeys = (
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  required: readonly string[],
): boolean =>
  Object.keys(value).every((key) => allowed.has(key)) &&
  required.every((key) => Object.prototype.hasOwnProperty.call(value, key));

const isTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const hasValidResponseExtensions = (value: Readonly<Record<string, unknown>>): boolean =>
  (!owns(value, 'content') ||
    (isDenseContractArray(value.content) &&
      value.content.length <= TOOL_RESPONSE_EXTENSION_LIMITS.contentBlocks &&
      value.content.every(isMcpContentBlockContract))) &&
  (!owns(value, 'structuredContent') || isFiniteJsonValue(value.structuredContent)) &&
  (!owns(value, 'nextActions') ||
    (isDenseContractArray(value.nextActions) &&
      value.nextActions.length <= TOOL_RESPONSE_EXTENSION_LIMITS.nextActions &&
      isFiniteJsonValue(value.nextActions) &&
      value.nextActions.every(isNextActionContract)));

const isSidecarMessageUnchecked = (value: unknown): value is SidecarMessage => {
  if (!isClosedContractRecord(value)) return false;
  const type = value.type;
  if (typeof type !== 'string') return false;

  if (!isTimestamp(value.ts)) return false;

  if (type === 'hello') {
    return (
      hasExactContractKeys(value, HELLO_KEYS) &&
      value.version === PROTOCOL_VERSION &&
      (value.role === 'plugin' || value.role === 'sidecar')
    );
  }
  if (type === 'ready') {
    return hasExactContractKeys(value, READY_KEYS) && value.version === PROTOCOL_VERSION;
  }
  if (type === 'request') {
    const schema = typeof value.tool === 'string' ? toolSchemas[value.tool] : undefined;
    return (
      hasExactContractKeys(value, REQUEST_KEYS) &&
      isNonEmptyContractText(value.id) &&
      typeof value.tool === 'string' &&
      TOOL_NAME_SET.has(value.tool) &&
      schema !== undefined &&
      isFiniteJsonValue(value.payload) &&
      validateSchema(schema, value.payload).ok
    );
  }
  if (type === 'response') {
    if (!isNonEmptyContractText(value.id) || !hasValidResponseExtensions(value)) {
      return false;
    }
    if (value.ok === true) {
      return (
        hasOnlyKeys(value, RESPONSE_SUCCESS_KEYS, ['type', 'id', 'ts', 'ok', 'data']) &&
        isFiniteJsonValue(value.data)
      );
    }
    if (value.ok === false) {
      return (
        hasOnlyKeys(value, RESPONSE_FAILURE_KEYS, ['type', 'id', 'ts', 'ok', 'error']) &&
        isToolErrorContract(value.error)
      );
    }
    return false;
  }
  if (type === 'error') {
    return (
      hasOnlyKeys(value, ERROR_MESSAGE_KEYS, ['type', 'ts', 'message']) &&
      isNonEmptyContractText(value.message) &&
      (!owns(value, 'id') || isNonEmptyContractText(value.id)) &&
      (!owns(value, 'details') ||
        (isClosedContractRecord(value.details) && isFiniteJsonValue(value.details)))
    );
  }
  return false;
};

export const isSidecarMessage = (value: unknown): value is SidecarMessage => {
  try {
    return isSidecarMessageUnchecked(value);
  } catch (_error) {
    return false;
  }
};
