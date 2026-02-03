import assert from 'node:assert/strict';

import { appendMissingRevisionNextActions } from '../../src/shared/tooling/revisionNextActions';
import type { ToolResponse } from '../../src/types';

{
  const response: ToolResponse<unknown> = {
    ok: false,
    error: {
      code: 'invalid_state',
      message: 'ifRevision is required',
      details: { reason: 'missing_ifRevision' }
    }
  };

  const result = appendMissingRevisionNextActions('model_pipeline', { mode: 'merge' }, response);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(Array.isArray(result.nextActions));
    assert.equal(result.nextActions?.length, 2);
    assert.equal(result.nextActions?.[0]?.type, 'call_tool');
    assert.equal((result.nextActions?.[0] as { tool?: string }).tool, 'get_project_state');
    assert.equal((result.nextActions?.[1] as { tool?: string }).tool, 'model_pipeline');
  }
}

{
  const response: ToolResponse<unknown> = {
    ok: false,
    error: {
      code: 'invalid_state',
      message: 'ifRevision is required',
      details: { reason: 'missing_ifRevision' }
    },
    nextActions: [
      { type: 'call_tool', tool: 'get_project_state', arguments: { detail: 'summary' }, reason: 'Existing', priority: 1 }
    ]
  };

  const result = appendMissingRevisionNextActions('model_pipeline', { mode: 'merge' }, response);
  assert.equal(result.ok, false);
  if (!result.ok) {
    const calls = result.nextActions?.filter((action) => action.type === 'call_tool') ?? [];
    assert.equal(calls.length, 2);
    const tools = calls.map((action) => (action as { tool?: string }).tool);
    assert.deepEqual(tools.sort(), ['get_project_state', 'model_pipeline']);
  }
}
