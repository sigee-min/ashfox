import assert from 'node:assert/strict';

import { createRuntimeServerState, restartServer, type RuntimeServerState } from '../src/plugin/runtimeServer';
import { noopLog } from './helpers';

const endpoint = { host: '127.0.0.1', port: 8787, path: '/mcp' };

{
  let inlineStopped = false;
  let prevInlineStopped = false;
  const state: RuntimeServerState = createRuntimeServerState(endpoint);
  state.inlineServerStop = () => {
    prevInlineStopped = true;
  };

  const next = restartServer({
    endpointConfig: endpoint,
    dispatcher: { handle: async () => ({ ok: true, data: {} }) } as never,
    logLevel: 'info',
    resourceStore: { list: () => [], get: () => null, put: () => undefined, delete: () => undefined } as never,
    toolRegistry: { hash: 'h', count: 0, list: () => [], get: () => null } as never,
    state,
    readGlobals: () => ({ Blockbench: { isWeb: false } }),
    startInlineServer: () => () => {
      inlineStopped = true;
    },
    createSidecar: () => {
      throw new Error('sidecar should not be created when inline server starts');
    }
  });

  assert.equal(prevInlineStopped, true);
  assert.equal(typeof next.inlineServerStop, 'function');
  assert.equal(next.sidecar, null);
  assert.equal(next.status.mode, 'inline');
  assert.equal(next.status.endpoint.port, 8787);

  next.inlineServerStop?.();
  assert.equal(inlineStopped, true);
}

{
  const created: Array<{ started: boolean; stopped: boolean }> = [];
  const state: RuntimeServerState = createRuntimeServerState(endpoint);

  const next = restartServer({
    endpointConfig: endpoint,
    dispatcher: { handle: async () => ({ ok: true, data: {} }) } as never,
    logLevel: 'info',
    resourceStore: { list: () => [], get: () => null, put: () => undefined, delete: () => undefined } as never,
    toolRegistry: { hash: 'h', count: 0, list: () => [], get: () => null } as never,
    state,
    readGlobals: () => ({ Blockbench: { isWeb: false } }),
    startInlineServer: () => null,
    createSidecar: () => {
      const holder = { started: false, stopped: false };
      created.push(holder);
      return {
        start: () => {
          holder.started = true;
          return true;
        },
        stop: () => {
          holder.stopped = true;
        }
      };
    }
  });

  assert.equal(created.length, 1);
  assert.equal(created[0].started, true);
  assert.equal(next.status.mode, 'sidecar');
  assert.equal(next.status.reason, 'inline_unavailable');
  assert.ok(next.sidecar);
}

{
  const state: RuntimeServerState = createRuntimeServerState(endpoint);

  const next = restartServer({
    endpointConfig: endpoint,
    dispatcher: { handle: async () => ({ ok: true, data: {} }) } as never,
    logLevel: 'info',
    resourceStore: { list: () => [], get: () => null, put: () => undefined, delete: () => undefined } as never,
    toolRegistry: { hash: 'h', count: 0, list: () => [], get: () => null } as never,
    state,
    readGlobals: () => ({ Blockbench: { isWeb: true } }),
    startInlineServer: () => {
      throw new Error('inline server must not start in web mode');
    },
    createSidecar: () => {
      throw new Error('sidecar must not start in web mode');
    }
  });

  assert.equal(next.status.mode, 'stopped');
  assert.equal(next.status.reason, 'web_mode');
}

{
  const state: RuntimeServerState = createRuntimeServerState(endpoint);

  const next = restartServer({
    endpointConfig: endpoint,
    dispatcher: null,
    logLevel: 'info',
    resourceStore: { list: () => [], get: () => null, put: () => undefined, delete: () => undefined } as never,
    toolRegistry: { hash: 'h', count: 0, list: () => [], get: () => null } as never,
    state,
    readGlobals: () => ({ Blockbench: { isWeb: false } }),
    startInlineServer: () => {
      throw new Error('inline server must not start without dispatcher');
    },
    createSidecar: () => {
      throw new Error('sidecar must not start without dispatcher');
    },
    loggerFactory: () => noopLog
  });

  assert.equal(next.status.mode, 'stopped');
  assert.equal(next.status.reason, 'dispatcher_missing');
}
