import {
  isMcpContentBlockContract,
  isNextActionContract,
  isToolErrorContract,
  TOOL_RESPONSE_EXTENSION_LIMITS,
  type McpContentBlock,
  type NextAction,
  type ToolResponse,
} from '@ashfox/blockbench-contracts/types/internal';
import {
  createFiniteJsonSnapshot,
  isClosedContractRecord,
  isDenseContractArray,
} from '@ashfox/internal-contracts';
import { errFromDomain, normalizeToolError, toolError } from './toolResponse';
import { TOOL_ERROR_GENERIC, TOOL_RESPONSE_MALFORMED } from '../messages';

type GuardContext = { source?: string };

const normalizeActions = (value: unknown): NextAction[] | undefined => {
  if (!isDenseContractArray(value) || value.length > TOOL_RESPONSE_EXTENSION_LIMITS.nextActions) {
    return undefined;
  }
  return value.filter(isNextActionContract);
};

const normalizeContent = (value: unknown): McpContentBlock[] | undefined => {
  if (!isDenseContractArray(value) || value.length > TOOL_RESPONSE_EXTENSION_LIMITS.contentBlocks) {
    return undefined;
  }
  return value.filter(isMcpContentBlockContract);
};

const SUCCESS_KEYS = new Set(['ok', 'data', 'content', 'structuredContent', 'nextActions']);
const FAILURE_KEYS = new Set(['ok', 'error', 'content', 'structuredContent', 'nextActions']);
const owns = (value: Readonly<Record<string, unknown>>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const hasClosedResponseShape = (
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  required: string,
): boolean =>
  owns(value, 'ok') && owns(value, required) && Object.keys(value).every((key) => allowed.has(key));

const malformedResponse = (context: GuardContext): ToolResponse<unknown> => ({
  ok: false,
  error: toolError('unknown', TOOL_RESPONSE_MALFORMED, {
    reason: 'malformed_tool_response',
    source: context.source ?? 'unknown',
  }),
});

export const normalizeToolResponseShape = (
  value: unknown,
  context: GuardContext = {},
): ToolResponse<unknown> => {
  const snapshot = createFiniteJsonSnapshot(value, {
    depthAllowance: TOOL_RESPONSE_EXTENSION_LIMITS.finiteJsonEnvelopeDepth,
    omitUndefinedObjectProperties: true,
    objectPrototype: 'standard',
  });
  if (
    !snapshot.ok ||
    !isClosedContractRecord(snapshot.value) ||
    typeof snapshot.value.ok !== 'boolean'
  ) {
    return malformedResponse(context);
  }
  const normalizedValue = snapshot.value;
  if (normalizedValue.ok) {
    if (!hasClosedResponseShape(normalizedValue, SUCCESS_KEYS, 'data')) {
      return malformedResponse(context);
    }
    const content = normalizeContent(normalizedValue.content);
    const nextActions = normalizeActions(normalizedValue.nextActions);
    return {
      ok: true,
      data: normalizedValue.data,
      ...(content ? { content } : {}),
      ...(owns(normalizedValue, 'structuredContent')
        ? { structuredContent: normalizedValue.structuredContent }
        : {}),
      ...(nextActions ? { nextActions } : {}),
    };
  }
  if (!hasClosedResponseShape(normalizedValue, FAILURE_KEYS, 'error')) {
    return malformedResponse(context);
  }
  const error = isToolErrorContract(normalizedValue.error)
    ? normalizedValue.error
    : toolError('unknown', TOOL_ERROR_GENERIC, {
        reason: 'malformed_tool_error',
        source: context.source ?? 'unknown',
      });
  const content = normalizeContent(normalizedValue.content);
  const nextActions = normalizeActions(normalizedValue.nextActions);
  return {
    ok: false,
    error,
    ...(content ? { content } : {}),
    ...(owns(normalizedValue, 'structuredContent')
      ? { structuredContent: normalizedValue.structuredContent }
      : {}),
    ...(nextActions ? { nextActions } : {}),
  };
};

export const normalizeToolResponse = (
  value: unknown,
  options: { source?: string; ensureReason?: boolean; preserveContent?: boolean } = {},
): ToolResponse<unknown> => {
  const normalized = normalizeToolResponseShape(value, { source: options.source });
  if (normalized.ok || !options.ensureReason) return normalized;
  const error = normalizeToolError(normalized.error, { ensureReason: true });
  if (options.preserveContent) {
    return { ...normalized, error };
  }
  return errFromDomain(error);
};
