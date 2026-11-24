import assert from 'node:assert/strict';

import { TOOL_NAMES } from '../../../blockbench-contracts/src/mcpSchemas/constants';
import { toolSchemas } from '../../../blockbench-contracts/src/mcpSchemas/toolSchemas';
import { DEFAULT_TOOL_REGISTRY } from '../../../blockbench-runtime/src/transport/mcp/tools';

assert.equal(Object.prototype.hasOwnProperty.call(toolSchemas, 'export'), false);
assert.equal((TOOL_NAMES as readonly string[]).includes('export'), false);
assert.equal(DEFAULT_TOOL_REGISTRY.map.has('export'), false);
assert.equal(
  DEFAULT_TOOL_REGISTRY.tools.some((tool) => tool.name === 'export'),
  false,
);
assert.equal(DEFAULT_TOOL_REGISTRY.map.has('export_trace_log'), true);
