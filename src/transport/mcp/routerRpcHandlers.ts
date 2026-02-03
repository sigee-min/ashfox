import type { Logger } from '../../logging';
import type { ResourceStore } from '../../ports/resources';
import type { JsonRpcMessage, JsonRpcResponse, McpServerConfig } from './types';
import type { ToolExecutor } from './executor';
import type { McpSession, SessionStore } from './session';
import type { ToolRegistry } from './tools';
import { validateSchema } from '../../shared/mcpSchemas/validation';
import { markSchemaValidated } from '../../shared/mcpSchemas/validationFlag';
import {
  DEFAULT_PROTOCOL_VERSION,
  DEFAULT_SUPPORTED_PROTOCOLS,
  isJsonRpcMessage,
  isRecord,
  jsonRpcError,
  jsonRpcResult,
  makeTextContent,
  toCallToolResult
} from './routerUtils';
import {
  MCP_INITIALIZE_REQUIRES_ID,
  MCP_JSONRPC_INVALID_REQUEST,
  MCP_METHOD_NOT_FOUND,
  MCP_RESOURCE_NOT_FOUND,
  MCP_SERVER_NOT_INITIALIZED,
  MCP_SESSION_UNAVAILABLE,
  MCP_TOOL_EXECUTION_FAILED,
  MCP_TOOL_NAME_REQUIRED,
  MCP_UNKNOWN_TOOL,
  MCP_URI_REQUIRED
} from '../../shared/messages';
import { err } from '../../shared/tooling/toolResponse';
import { errorMessage } from '../../logging';

export type RpcOutcome =
  | { type: 'notification' }
  | { type: 'response'; response: JsonRpcResponse; status: number };

export type RpcContext = {
  executor: ToolExecutor;
  log: Logger;
  resources?: ResourceStore;
  toolRegistry: ToolRegistry;
  sessions: SessionStore;
  supportedProtocols?: string[];
  config: McpServerConfig;
};

const pickProtocolVersion = (supported: string[], requested: string) =>
  supported.includes(requested) ? requested : DEFAULT_PROTOCOL_VERSION;

export const handleMessage = async (
  ctx: RpcContext,
  message: JsonRpcMessage,
  session: McpSession | null,
  id: JsonRpcResponse['id']
): Promise<RpcOutcome> => {
  const isNotification = !('id' in message);
  const supportedProtocols = ctx.supportedProtocols ?? DEFAULT_SUPPORTED_PROTOCOLS;

  if (!isJsonRpcMessage(message)) {
    return { type: 'response', response: jsonRpcError(id, -32600, MCP_JSONRPC_INVALID_REQUEST), status: 400 };
  }

  if (message.method === 'initialize') {
    if (isNotification || id === null) {
      return { type: 'response', response: jsonRpcError(id, -32600, MCP_INITIALIZE_REQUIRES_ID), status: 400 };
    }
    if (!session) {
      return { type: 'response', response: jsonRpcError(id, -32000, MCP_SESSION_UNAVAILABLE), status: 400 };
    }
    const params = isRecord(message.params) ? message.params : {};
    const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : DEFAULT_PROTOCOL_VERSION;
    const protocolVersion = pickProtocolVersion(supportedProtocols, requested);
    session.protocolVersion = protocolVersion;
    session.initialized = true;
    const result = {
      protocolVersion,
      capabilities: { tools: { listChanged: true }, resources: { listChanged: Boolean(ctx.resources) } },
      serverInfo: ctx.config.serverInfo,
      instructions: ctx.config.instructions
    };
    return { type: 'response', response: jsonRpcResult(id, result), status: 200 };
  }

  if (message.method === 'notifications/initialized') {
    if (session) session.initialized = true;
    return { type: 'notification' };
  }

  if (!session || !session.initialized) {
    return { type: 'response', response: jsonRpcError(id, -32000, MCP_SERVER_NOT_INITIALIZED), status: 400 };
  }

  if (isNotification) {
    return { type: 'notification' };
  }

  if (message.method === 'tools/list') {
    const result = { tools: ctx.toolRegistry.tools };
    return { type: 'response', response: jsonRpcResult(id, result), status: 200 };
  }

  if (message.method === 'tools/call') {
    return handleToolCall(ctx, message, session, id);
  }

  if (message.method === 'resources/list') {
    const list = ctx.resources?.list() ?? [];
    const result = { resources: list, nextCursor: null };
    return { type: 'response', response: jsonRpcResult(id, result), status: 200 };
  }

  if (message.method === 'resources/read') {
    const params = isRecord(message.params) ? message.params : {};
    const uri = typeof params.uri === 'string' ? params.uri : '';
    if (!uri) {
      return { type: 'response', response: jsonRpcError(id, -32602, MCP_URI_REQUIRED), status: 400 };
    }
    const entry = ctx.resources?.read(uri) ?? null;
    if (!entry) {
      return {
        type: 'response',
        response: jsonRpcError(id, -32602, MCP_RESOURCE_NOT_FOUND),
        status: 404
      };
    }
    const result = {
      contents: [
        {
          uri: entry.uri,
          mimeType: entry.mimeType,
          text: entry.text
        }
      ]
    };
    return { type: 'response', response: jsonRpcResult(id, result), status: 200 };
  }

  if (message.method === 'resources/templates/list') {
    const templates = ctx.resources?.listTemplates() ?? [];
    const result = { resourceTemplates: templates, nextCursor: null };
    return { type: 'response', response: jsonRpcResult(id, result), status: 200 };
  }

  if (message.method === 'ping') {
    return { type: 'response', response: jsonRpcResult(id, {}), status: 200 };
  }

  return {
    type: 'response',
    response: jsonRpcError(id, -32601, MCP_METHOD_NOT_FOUND(message.method)),
    status: 400
  };
};

export const handleToolCall = async (
  ctx: RpcContext,
  message: JsonRpcMessage,
  session: McpSession,
  id: JsonRpcResponse['id']
): Promise<RpcOutcome> => {
  const params = isRecord(message.params) ? message.params : {};
  const name = typeof params.name === 'string' ? params.name : null;
  if (!name) {
    return { type: 'response', response: jsonRpcError(id, -32602, MCP_TOOL_NAME_REQUIRED), status: 400 };
  }
  if (!ctx.toolRegistry.map.has(name)) {
    return { type: 'response', response: jsonRpcError(id, -32602, MCP_UNKNOWN_TOOL(name)), status: 400 };
  }
  const args = isRecord(params.arguments) ? params.arguments : {};
  const schema = ctx.toolRegistry.map.get(name)?.inputSchema ?? null;
  if (schema) {
    const validation = validateSchema(schema, args);
    if (!validation.ok) {
      const toolError = err('invalid_payload', validation.message, {
        reason: 'schema_validation',
        path: validation.path,
        rule: validation.reason,
        ...(validation.details ?? {}),
        tool: name
      });
      const result = toCallToolResult(toolError);
      return { type: 'response', response: jsonRpcResult(id, result), status: 200 };
    }
    markSchemaValidated(args);
  }

  ctx.sessions.touch(session);
  try {
    const response = await ctx.executor.callTool(name, args);
    const result = toCallToolResult(response);
    return { type: 'response', response: jsonRpcResult(id, result), status: 200 };
  } catch (err) {
    const messageText = errorMessage(err, MCP_TOOL_EXECUTION_FAILED);
    ctx.log.error('tool execution failed', { tool: name, message: messageText });
    const result = { isError: true, content: makeTextContent(messageText) };
    return { type: 'response', response: jsonRpcResult(id, result), status: 200 };
  }
};
