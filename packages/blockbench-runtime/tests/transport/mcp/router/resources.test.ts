import assert from 'node:assert/strict';

import {
  handleResourceTemplatesList,
  handleResourcesList,
  handleResourcesRead,
} from '../../../../src/transport/mcp/routerRpcResources';
import type { RpcContext } from '../../../../src/transport/mcp/routerRpcTypes';
import type { ToolExecutor } from '../../../../src/transport/mcp/executor';
import { SessionStore } from '../../../../src/transport/mcp/session';
import type { ToolRegistry } from '../../../../src/transport/mcp/tools';
import type { ResourceStore } from '../../../../src/ports/resources';
import { noopLog } from '../../../helpers';
import { MCP_RESOURCE_NOT_FOUND, MCP_URI_REQUIRED } from '../../../../src/shared/messages';

const createContext = (resources?: RpcContext['resources']): RpcContext => {
  const executor: ToolExecutor = {
    callTool: async () => ({ ok: true, data: {} }),
  };
  const toolRegistry: ToolRegistry = {
    tools: [],
    map: new Map(),
    hash: 'test',
    count: 0,
  };
  return {
    executor,
    log: noopLog,
    resources,
    toolRegistry,
    sessions: new SessionStore(),
    config: { path: '/mcp' },
  };
};

const createResources = (overrides: Partial<ResourceStore> = {}): ResourceStore => ({
  list: () => [],
  read: () => null,
  listTemplates: () => [],
  has: () => false,
  put: () => undefined,
  ...overrides,
});

{
  const outcome = handleResourcesList(createContext(), 1);
  assert.equal(outcome.type, 'response');
  if (outcome.type !== 'response') throw new Error('Expected a response.');
  assert.equal(outcome.status, 200);
  assert.deepEqual(outcome.response.result, { resources: [], nextCursor: null });
}

{
  const outcome = handleResourcesRead(
    createContext(),
    { jsonrpc: '2.0', method: 'resources/read', params: {} },
    1,
  );
  assert.equal(outcome.type, 'response');
  if (outcome.type !== 'response') throw new Error('Expected a response.');
  assert.equal(outcome.status, 400);
  assert.equal(outcome.response.error?.message, MCP_URI_REQUIRED);
}

{
  const outcome = handleResourcesRead(
    createContext(createResources()),
    { jsonrpc: '2.0', method: 'resources/read', params: { uri: 'ashfox://missing' } },
    1,
  );
  assert.equal(outcome.type, 'response');
  if (outcome.type !== 'response') throw new Error('Expected a response.');
  assert.equal(outcome.status, 404);
  assert.equal(outcome.response.error?.message, MCP_RESOURCE_NOT_FOUND);
}

{
  const outcome = handleResourcesRead(
    createContext(
      createResources({
        read: (uri) => ({ uri, mimeType: 'application/json', text: '{"ok":true}' }),
      }),
    ),
    {
      jsonrpc: '2.0',
      method: 'resources/read',
      params: { uri: 'ashfox://logs/trace-report.json' },
    },
    5,
  );
  assert.equal(outcome.type, 'response');
  if (outcome.type !== 'response') throw new Error('Expected a response.');
  assert.equal(outcome.status, 200);
  assert.deepEqual(outcome.response.result, {
    contents: [
      {
        uri: 'ashfox://logs/trace-report.json',
        mimeType: 'application/json',
        text: '{"ok":true}',
      },
    ],
  });
}

{
  const outcome = handleResourceTemplatesList(
    createContext(
      createResources({
        listTemplates: () => [{ uriTemplate: 'ashfox://textures/{name}', name: 'Texture by name' }],
      }),
    ),
    9,
  );
  assert.equal(outcome.type, 'response');
  if (outcome.type !== 'response') throw new Error('Expected a response.');
  assert.equal(outcome.status, 200);
  assert.deepEqual(outcome.response.result, {
    resourceTemplates: [{ uriTemplate: 'ashfox://textures/{name}', name: 'Texture by name' }],
    nextCursor: null,
  });
}
