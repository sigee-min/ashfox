import assert from 'node:assert/strict';

import {
  createRuntimeServerState,
  restartServer,
  type RuntimeServerState,
} from '../../../src/plugin/runtimeServer';
import type { ServerConfig } from '../../../src/serverConfig';
import type { SidecarLaunchConfig } from '../../../src/sidecar/types';
import { noopLog, registerAsync } from '../../helpers';

const endpoint = { host: '127.0.0.1', port: 8787, path: '/mcp' };

registerAsync(
  (async () => {
    let inlineStopped = false;
    let prevInlineStopped = false;
    const state: RuntimeServerState = createRuntimeServerState(endpoint);
    state.inlineServer = {
      ready: Promise.resolve(),
      stop: () => {
        prevInlineStopped = true;
      },
    };

    const next = restartServer({
      endpointConfig: endpoint,
      dispatcher: { handle: async () => ({ ok: true, data: {} }) } as never,
      logLevel: 'info',
      resourceStore: {
        list: () => [],
        get: () => null,
        put: () => undefined,
        delete: () => undefined,
      } as never,
      toolRegistry: { hash: 'h', count: 0, list: () => [], get: () => null } as never,
      state,
      readGlobals: () => ({ Blockbench: { isWeb: false } }),
      startInlineServer: () => ({
        ready: Promise.resolve(),
        stop: () => {
          inlineStopped = true;
        },
      }),
      createSidecar: () => {
        throw new Error('sidecar should not be created when inline server starts');
      },
    });

    assert.equal(prevInlineStopped, true);
    assert.notEqual(next.inlineServer, null);
    assert.equal(next.sidecar, null);
    assert.equal(next.status.mode, 'starting');
    await Promise.resolve();
    assert.equal(next.status.mode, 'inline');
    assert.equal(next.status.endpoint.port, 8787);

    next.inlineServer?.stop();
    assert.equal(inlineStopped, true);
  })(),
);

registerAsync(
  (async () => {
    const state: RuntimeServerState = createRuntimeServerState(endpoint);
    let stopped = false;
    const ready: { reject?: (error: Error) => void } = {};
    const next = restartServer({
      endpointConfig: endpoint,
      dispatcher: { handle: async () => ({ ok: true, data: {} }) } as never,
      logLevel: 'info',
      resourceStore: {
        list: () => [],
        get: () => null,
        put: () => undefined,
        delete: () => undefined,
      } as never,
      toolRegistry: { hash: 'h', count: 0, list: () => [], get: () => null } as never,
      state,
      readGlobals: () => ({ Blockbench: { isWeb: false } }),
      startInlineServer: () => ({
        ready: new Promise<void>((_resolve, reject) => {
          ready.reject = reject;
        }),
        stop: () => {
          stopped = true;
        },
      }),
      createSidecar: () => {
        throw new Error('async listen failure must not report a running sidecar');
      },
      loggerFactory: () => noopLog,
    });
    assert.equal(next.status.mode, 'starting');
    assert.ok(ready.reject);
    ready.reject(new Error('EADDRINUSE'));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(stopped, true);
    assert.equal(next.inlineServer, null);
    assert.equal(next.status.mode, 'stopped');
    assert.equal(next.status.reason, 'inline_start_failed');
  })(),
);

{
  const created: Array<{ started: boolean; stopped: boolean }> = [];
  const state: RuntimeServerState = createRuntimeServerState(endpoint);

  const next = restartServer({
    endpointConfig: endpoint,
    dispatcher: { handle: async () => ({ ok: true, data: {} }) } as never,
    logLevel: 'info',
    resourceStore: {
      list: () => [],
      get: () => null,
      put: () => undefined,
      delete: () => undefined,
    } as never,
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
        },
      };
    },
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
    resourceStore: {
      list: () => [],
      get: () => null,
      put: () => undefined,
      delete: () => undefined,
    } as never,
    toolRegistry: { hash: 'h', count: 0, list: () => [], get: () => null } as never,
    state,
    readGlobals: () => ({ Blockbench: { isWeb: true } }),
    startInlineServer: () => {
      throw new Error('inline server must not start in web mode');
    },
    createSidecar: () => {
      throw new Error('sidecar must not start in web mode');
    },
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
    resourceStore: {
      list: () => [],
      get: () => null,
      put: () => undefined,
      delete: () => undefined,
    } as never,
    toolRegistry: { hash: 'h', count: 0, list: () => [], get: () => null } as never,
    state,
    readGlobals: () => ({ Blockbench: { isWeb: false } }),
    startInlineServer: () => {
      throw new Error('inline server must not start without dispatcher');
    },
    createSidecar: () => {
      throw new Error('sidecar must not start without dispatcher');
    },
    loggerFactory: () => noopLog,
  });

  assert.equal(next.status.mode, 'stopped');
  assert.equal(next.status.reason, 'dispatcher_missing');
}

{
  const remoteEndpoint = { host: '0.0.0.0', port: 8787, path: '/mcp' };
  const state: RuntimeServerState = createRuntimeServerState(remoteEndpoint);
  let inlineStarted = false;
  let sidecarCreated = false;

  const next = restartServer({
    endpointConfig: remoteEndpoint,
    dispatcher: { handle: async () => ({ ok: true, data: {} }) } as never,
    logLevel: 'info',
    resourceStore: {
      list: () => [],
      get: () => null,
      put: () => undefined,
      delete: () => undefined,
    } as never,
    toolRegistry: { hash: 'h', count: 0, list: () => [], get: () => null } as never,
    state,
    readGlobals: () => ({ Blockbench: { isWeb: false } }),
    startInlineServer: () => {
      inlineStarted = true;
      return null;
    },
    createSidecar: () => {
      sidecarCreated = true;
      return { start: () => true, stop: () => undefined };
    },
    loggerFactory: () => noopLog,
  });

  assert.equal(inlineStarted, false);
  assert.equal(sidecarCreated, false);
  assert.equal(next.status.mode, 'stopped');
  assert.equal(next.status.reason, 'non_loopback_token_required');
  assert.equal('token' in next.status.endpoint, false);
}

{
  const remoteEndpoint = {
    host: ' 0.0.0.0 ',
    port: 8787,
    path: 'mcp/',
    token: ' explicit-secret ',
  };
  const state: RuntimeServerState = createRuntimeServerState(remoteEndpoint);
  const captured: {
    inline?: ServerConfig;
    sidecar?: SidecarLaunchConfig;
  } = {};

  const next = restartServer({
    endpointConfig: remoteEndpoint,
    dispatcher: { handle: async () => ({ ok: true, data: {} }) } as never,
    logLevel: 'info',
    resourceStore: {
      list: () => [],
      get: () => null,
      put: () => undefined,
      delete: () => undefined,
    } as never,
    toolRegistry: { hash: 'h', count: 0, list: () => [], get: () => null } as never,
    state,
    readGlobals: () => ({ Blockbench: { isWeb: false } }),
    startInlineServer: (config) => {
      captured.inline = config;
      return null;
    },
    createSidecar: (config) => {
      captured.sidecar = config;
      return { start: () => true, stop: () => undefined };
    },
    loggerFactory: () => noopLog,
  });

  assert.deepEqual(captured.inline, {
    host: '0.0.0.0',
    port: 8787,
    path: '/mcp',
    token: 'explicit-secret',
  });
  assert.deepEqual(captured.sidecar, captured.inline);
  assert.equal(next.status.mode, 'sidecar');
  assert.equal(next.status.reason, 'inline_unavailable');
  assert.deepEqual(next.status.endpoint, { host: '0.0.0.0', port: 8787, path: '/mcp' });
  assert.equal('token' in next.status.endpoint, false);
}
