import assert from 'node:assert/strict';

import type { ModelPipelinePayload } from '../../src/spec';
import { modelPipelineProxy } from '../../src/proxy/modelPipeline';
import { makeProxyDeps, ok, registerAsync } from './helpers';

registerAsync(
  (async () => {
    const deps = makeProxyDeps({
      service: {
        isRevisionRequired: () => true,
        isAutoRetryRevisionEnabled: () => false,
        getProjectState: () =>
          ok({
            project: {
              id: 'p1',
              active: true,
              name: null,
              format: null,
              revision: 'r1',
              counts: { bones: 0, cubes: 0, textures: 0, animations: 0 }
            }
          })
      }
    });

    const payload: ModelPipelinePayload = {
      mode: 'replace',
      model: {
        cube: { id: 'cube_base', name: 'base', from: [0, 0, 0], to: [1, 1, 1] }
      }
    };

    const res = await modelPipelineProxy(deps, payload);
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.error.code, 'invalid_state');
      assert.equal((res.error.details as { reason?: unknown })?.reason, 'missing_ifRevision');
    }
  })()
);
