import assert from 'node:assert/strict';

import { TOOL_SCHEMA_VERSION as RUNTIME_SCHEMA_VERSION } from '../../../blockbench-runtime/src/config';
import { DEFAULT_TOOL_REGISTRY } from '../../../blockbench-runtime/src/transport/mcp/tools';
import {
  TOOL_SCHEMA_VERSION as CONTRACT_SCHEMA_VERSION,
  computeToolRegistryHash
} from '../../../blockbench-contracts/src/mcpSchemas/policy';

assert.equal(CONTRACT_SCHEMA_VERSION, '1');
assert.equal(RUNTIME_SCHEMA_VERSION, CONTRACT_SCHEMA_VERSION);

assert.equal(DEFAULT_TOOL_REGISTRY.hash, computeToolRegistryHash(DEFAULT_TOOL_REGISTRY.tools));
