import {
  CUBE_FACE_DIRECTIONS,
  ENSURE_PROJECT_ACTIONS,
  ENSURE_PROJECT_MATCHES,
  ENSURE_PROJECT_ON_MISMATCH,
  ENSURE_PROJECT_ON_MISSING,
  FORMAT_KINDS,
  PROJECT_STATE_DETAILS,
  TOOL_ERROR_CODES,
  TOOL_NAMES,
} from '../mcpSchemas/constants';
import {
  hasExactContractKeys,
  isClosedContractRecord,
  isDenseContractArray,
  isFiniteJsonValue,
  isNonEmptyContractText,
} from '@ashfox/internal-contracts';

export type FormatKind = (typeof FORMAT_KINDS)[number];
export type ProjectStateDetail = (typeof PROJECT_STATE_DETAILS)[number];
export type ToolName = (typeof TOOL_NAMES)[number];
export type EnsureProjectMatch = (typeof ENSURE_PROJECT_MATCHES)[number];
export type EnsureProjectOnMismatch = (typeof ENSURE_PROJECT_ON_MISMATCH)[number];
export type EnsureProjectOnMissing = (typeof ENSURE_PROJECT_ON_MISSING)[number];
export type EnsureProjectAction = (typeof ENSURE_PROJECT_ACTIONS)[number];
export type CubeFaceDirection = (typeof CUBE_FACE_DIRECTIONS)[number];

export {
  CUBE_FACE_DIRECTIONS,
  ENSURE_PROJECT_ACTIONS,
  ENSURE_PROJECT_MATCHES,
  ENSURE_PROJECT_ON_MISMATCH,
  ENSURE_PROJECT_ON_MISSING,
  FORMAT_KINDS,
  PROJECT_STATE_DETAILS,
  TOOL_ERROR_CODES,
  TOOL_NAMES,
};

export interface IncludeStateOption {
  includeState?: boolean;
}

export interface IncludeDiffOption {
  includeDiff?: boolean;
  diffDetail?: ProjectStateDetail;
}

export interface IfRevisionOption {
  ifRevision?: string;
}

export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];

export interface ToolError {
  code: ToolErrorCode;
  message: string;
  fix?: string;
  details?: Record<string, unknown>;
}

const TOOL_ERROR_KEYS = new Set(['code', 'message', 'fix', 'details']);
const TOOL_ERROR_CODE_SET = new Set<string>(TOOL_ERROR_CODES);
const owns = (value: Readonly<Record<string, unknown>>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

export const isToolErrorContract = (value: unknown): value is ToolError => {
  if (
    !isClosedContractRecord(value) ||
    !Object.keys(value).every((key) => TOOL_ERROR_KEYS.has(key)) ||
    !owns(value, 'code') ||
    !owns(value, 'message') ||
    typeof value.code !== 'string' ||
    !TOOL_ERROR_CODE_SET.has(value.code) ||
    !isNonEmptyContractText(value.message)
  ) {
    return false;
  }
  if (owns(value, 'fix') && !isNonEmptyContractText(value.fix)) return false;
  return (
    !owns(value, 'details') ||
    (isClosedContractRecord(value.details) && isFiniteJsonValue(value.details))
  );
};

export type NextActionRef =
  | {
      kind: 'tool';
      tool: string;
      pointer: string;
      note?: string;
    }
  | {
      kind: 'user';
      hint: string;
    };

export type NextActionValueRef = { $ref: NextActionRef };

export type NextActionArgPrimitive = string | number | boolean | null;

export type NextActionArgValue =
  | NextActionArgPrimitive
  | NextActionValueRef
  | NextActionArgValue[]
  | { [key: string]: NextActionArgValue };

export type NextActionArgs = Record<string, NextActionArgValue>;

export type NextAction =
  | {
      type: 'call_tool';
      tool: string;
      arguments: NextActionArgs;
      reason: string;
      priority?: number;
    }
  | {
      type: 'read_resource';
      uri: string;
      reason: string;
      priority?: number;
    }
  | {
      type: 'ask_user';
      question: string;
      reason: string;
      priority?: number;
    }
  | {
      type: 'noop';
      reason: string;
      priority?: number;
    };

export type McpTextContent = { type: 'text'; text: string };

export type McpImageContent = { type: 'image'; data: string; mimeType: string };

export type McpContentBlock = McpTextContent | McpImageContent;

export const TOOL_RESPONSE_EXTENSION_LIMITS = Object.freeze({
  contentBlocks: 256,
  nextActions: 64,
  finiteJsonEnvelopeDepth: 3,
});

const hasOnlyKeys = (
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  required: readonly string[],
): boolean =>
  Object.keys(value).every((key) => allowed.has(key)) &&
  required.every((key) => Object.prototype.hasOwnProperty.call(value, key));

export const isMcpContentBlockContract = (value: unknown): value is McpContentBlock => {
  if (!isClosedContractRecord(value)) return false;
  if (value.type === 'text') {
    return hasExactContractKeys(value, new Set(['type', 'text'])) && typeof value.text === 'string';
  }
  if (value.type === 'image') {
    return (
      hasExactContractKeys(value, new Set(['type', 'data', 'mimeType'])) &&
      isNonEmptyContractText(value.data) &&
      isNonEmptyContractText(value.mimeType)
    );
  }
  return false;
};

const isNextActionRefContract = (value: unknown): value is NextActionRef => {
  if (!isClosedContractRecord(value)) return false;
  if (value.kind === 'tool') {
    return (
      hasOnlyKeys(value, new Set(['kind', 'tool', 'pointer', 'note']), [
        'kind',
        'tool',
        'pointer',
      ]) &&
      isNonEmptyContractText(value.tool) &&
      isNonEmptyContractText(value.pointer) &&
      (!owns(value, 'note') || isNonEmptyContractText(value.note))
    );
  }
  if (value.kind === 'user') {
    return (
      hasExactContractKeys(value, new Set(['kind', 'hint'])) && isNonEmptyContractText(value.hint)
    );
  }
  return false;
};

const isNextActionArgValueSemanticContract = (value: unknown): value is NextActionArgValue => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') return Number.isFinite(value);
  if (isDenseContractArray(value)) {
    return value.every((entry) => isNextActionArgValueSemanticContract(entry));
  }
  if (!isClosedContractRecord(value)) return false;
  if (owns(value, '$ref')) {
    return hasExactContractKeys(value, new Set(['$ref'])) && isNextActionRefContract(value.$ref);
  }
  return Object.values(value).every((entry) => isNextActionArgValueSemanticContract(entry));
};

const isNextActionArgValueContract = (value: unknown): value is NextActionArgValue =>
  isNextActionArgValueSemanticContract(value);

const hasOptionalFinitePriority = (value: Readonly<Record<string, unknown>>): boolean =>
  !owns(value, 'priority') ||
  (typeof value.priority === 'number' && Number.isFinite(value.priority));

const isNextActionContractUnchecked = (value: unknown): value is NextAction => {
  if (!isClosedContractRecord(value) || !hasOptionalFinitePriority(value)) {
    return false;
  }
  if (value.type === 'call_tool') {
    return (
      hasOnlyKeys(value, new Set(['type', 'tool', 'arguments', 'reason', 'priority']), [
        'type',
        'tool',
        'arguments',
        'reason',
      ]) &&
      isNonEmptyContractText(value.tool) &&
      isClosedContractRecord(value.arguments) &&
      isFiniteJsonValue(value.arguments) &&
      Object.values(value.arguments).every(isNextActionArgValueContract) &&
      isNonEmptyContractText(value.reason)
    );
  }
  if (value.type === 'read_resource') {
    return (
      hasOnlyKeys(value, new Set(['type', 'uri', 'reason', 'priority']), [
        'type',
        'uri',
        'reason',
      ]) &&
      isNonEmptyContractText(value.uri) &&
      isNonEmptyContractText(value.reason)
    );
  }
  if (value.type === 'ask_user') {
    return (
      hasOnlyKeys(value, new Set(['type', 'question', 'reason', 'priority']), [
        'type',
        'question',
        'reason',
      ]) &&
      isNonEmptyContractText(value.question) &&
      isNonEmptyContractText(value.reason)
    );
  }
  if (value.type === 'noop') {
    return (
      hasOnlyKeys(value, new Set(['type', 'reason', 'priority']), ['type', 'reason']) &&
      isNonEmptyContractText(value.reason)
    );
  }
  return false;
};

export const isNextActionContract = (value: unknown): value is NextAction => {
  try {
    return isNextActionContractUnchecked(value);
  } catch (_error) {
    return false;
  }
};

export type ToolResponse<T> =
  | {
      ok: true;
      data: T;
      content?: McpContentBlock[];
      structuredContent?: unknown;
      nextActions?: NextAction[];
    }
  | {
      ok: false;
      error: ToolError;
      content?: McpContentBlock[];
      structuredContent?: unknown;
      nextActions?: NextAction[];
    };

export type ToolErrorResponse = Extract<ToolResponse<unknown>, { ok: false }>;
