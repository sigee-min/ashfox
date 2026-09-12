import assert from 'node:assert/strict';

import { GUIDE_RESOURCES } from '../../../../src/shared/resources/guides';
import { SERVER_TOOL_INSTRUCTIONS, SIDECAR_TOOL_INSTRUCTIONS } from
  '../../../../src/shared/tooling/toolInstructions';
import { DEFAULT_TOOL_REGISTRY } from '../../../../src/transport/mcp/tools';

const compatibilityTools = new Set([
  'add_bone', 'update_bone', 'delete_bone',
  'add_cube', 'update_cube', 'delete_cube',
  'add_mesh', 'update_mesh', 'delete_mesh'
]);
for (const tool of DEFAULT_TOOL_REGISTRY.tools.filter((entry) =>
  compatibilityTools.has(entry.name))) {
  assert.match(tool.description ?? '', /compatibility session/i,
    `${tool.name} must disclose its non-canonical compatibility boundary.`);
}

const modelingGuide = GUIDE_RESOURCES.find((resource) =>
  resource.uri === 'ashfox://guide/modeling-workflow');
assert.ok(modelingGuide);
if (modelingGuide !== undefined) assert.match(modelingGuide.description ?? '',
  /compatibility-session/i);
if (modelingGuide !== undefined) {
  assert.match(modelingGuide.text, /Ashfox CLI/i);
  assert.equal(modelingGuide.text.includes('one item per call'), false);
}
assert.match(SERVER_TOOL_INSTRUCTIONS, /Ashfox CLI/i);
assert.match(SIDECAR_TOOL_INSTRUCTIONS, /Ashfox CLI/i);
assert.equal(SERVER_TOOL_INSTRUCTIONS.includes(
  'Modeling is low-level only: add_bone/add_cube'), false);
assert.equal(SIDECAR_TOOL_INSTRUCTIONS.includes(
  'Modeling is low-level only: add_bone/add_cube'), false);

assert.doesNotMatch(SERVER_TOOL_INSTRUCTIONS + SIDECAR_TOOL_INSTRUCTIONS + modelingGuide?.text, /Web Studio|agent manifest/);

console.log('Blockbench compatibility tools disclose canonical source boundary');
