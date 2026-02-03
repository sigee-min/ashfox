import assert from 'node:assert/strict';

import { McpRouter } from '../../src/transport/mcp/router';
import type { ToolExecutor } from '../../src/transport/mcp/executor';
import type { HttpRequest } from '../../src/transport/mcp/types';
import { noopLog, registerAsync } from './helpers';

const executor: ToolExecutor = {
  callTool: async () => {
    throw new Error('executor should not be called on schema validation failure');
  }
};

const router = new McpRouter({ path: '/mcp' }, executor, noopLog);

registerAsync(
  (async () => {
    const payload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'model_pipeline',
        arguments: {
          ensureProject: { name: 'flower_pot', onMissing: 'create', onMismatch: 'create', format: 'bedrock' },
          mode: 'replace',
          model: { cube: { id: 'cube_base', name: 'base', from: [0, 0, 0], to: [1, 1, 1] } }
        }
      }
    };

    const req: HttpRequest = {
      method: 'POST',
      url: 'http://localhost/mcp',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    };

    const res = await router.handle(req);
    assert.equal(res.kind, 'json');
    assert.equal(res.status, 200);
    if (res.kind !== 'json') return;
    const body = JSON.parse(res.body);
    const result = body.result;
    assert.equal(Boolean(result?.isError), true);
    assert.equal(result?.structuredContent?.code, 'invalid_payload');
    assert.equal(result?.structuredContent?.details?.reason, 'schema_validation');
    assert.equal(result?.structuredContent?.details?.path, '$.ensureProject.format');
    assert.deepEqual(result?.structuredContent?.details?.candidates, ['Java Block/Item', 'geckolib', 'animated_java']);
  })()
);
