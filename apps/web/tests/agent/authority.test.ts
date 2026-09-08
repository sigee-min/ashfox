import assert from 'node:assert/strict';

import { agentManifest } from '../../src/features/agent/agentManifest';
import { parseInspectRequest } from '../../src/features/agent/parseInspectRequest';
import { canonicalFingerprint } from '../../src/application/canonicalFingerprint';
import { listAgentCommandDefinitions } from '@ashfox/engine-core';

assert.deepEqual(agentManifest.commands.map((entry) => entry.name),
  ['workspace.apply']);
assert.equal(JSON.stringify(agentManifest.pageApi.inspect).includes('expectedWorkspaceHash'), true);
assert.equal(JSON.stringify(agentManifest.pageApi.run).includes('workspace.apply'), true);
assert.equal(agentManifest.compatibility.options.length, 5);
assert.ok(agentManifest.compatibility.options.every((option) =>
  !Reflect.has(option, 'isDefaultVersion')),
'The agent manifest must expose one current option without a default selector.');

// Verify the published JSON, not just the in-memory TypeScript examples.
const published: typeof agentManifest = JSON.parse(JSON.stringify(agentManifest));
assert.equal(published.schemaVersion, 2);
for (const request of published.pageApi.inspect.examples.requests) {
  assert.deepEqual(parseInspectRequest(request), { ok: true, request });
  assert.equal(parseInspectRequest({ ...request, extra: true }).ok, false);
  const missingGuard = request.kind === 'workspace'
    ? { ...request, ...(request.catalog ? { catalog: { offset: request.catalog.offset, limit: request.catalog.limit } }
      : { document: { document: request.document!.document, offset: request.document!.offset,
        maxCodeUnits: request.document!.maxCodeUnits } }) }
    : (({ expectedBuildKey: _guard, ...rest }) => rest)(request);
  assert.equal(parseInspectRequest(missingGuard).ok, false);
}
for (const definition of listAgentCommandDefinitions()) {
  assert.equal(published.commands.find((item) => item.name === definition.name)?.schemaHash,
    canonicalFingerprint(definition.inputSchema), 'published schema identity follows the current reader');
}
