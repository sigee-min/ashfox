import assert from 'node:assert/strict';

import type { Dispatcher, ToolResponse } from '@ashfox/blockbench-contracts/types/internal';
import { SidecarClient } from '../../../src/sidecar/transport/SidecarClient';
import { SidecarHost } from '../../../src/sidecar/transport/SidecarHost';
import type { IpcReadable, IpcWritable } from '../../../src/sidecar/transport/ipc';
import { SIDECAR_IPC_MAX_FRAME_BYTES, encodeMessage } from '../../../src/transport/codec';
import { normalizeSidecarMessage, type SidecarMessage } from '../../../src/transport/protocol';
import { noopLog, registerAsync, unsafePayload } from '../../helpers';

const createReadable = () => {
  const dataHandlers: Array<(chunk: string | Uint8Array) => void> = [];
  const readable = unsafePayload<IpcReadable>({
    on: (event: string, handler: (value?: unknown) => void) => {
      if (event === 'data') {
        dataHandlers.push(handler as (chunk: string | Uint8Array) => void);
      }
    },
    removeListener: (event: string, handler: (chunk: string | Uint8Array) => void) => {
      if (event !== 'data') return;
      const index = dataHandlers.indexOf(handler);
      if (index >= 0) dataHandlers.splice(index, 1);
    },
  });
  return {
    readable,
    emit: (message: SidecarMessage) => {
      const line = encodeMessage(message);
      dataHandlers.forEach((handler) => handler(line));
    },
  };
};

const createWritable = () => {
  const writes: string[] = [];
  const writable: IpcWritable = {
    write: (data) => {
      writes.push(data);
    },
  };
  return { writable, writes };
};

const readMessage = (line: string): Record<string, unknown> =>
  JSON.parse(line) as Record<string, unknown>;

assert.equal(
  normalizeSidecarMessage({
    type: 'request',
    id: 'retired-export',
    ts: 0,
    tool: 'export',
    payload: { format: 'gltf', destPath: 'retired.glb' },
  }),
  null,
);

registerAsync(
  (async () => {
    const input = createReadable();
    const output = createWritable();
    let dispatches = 0;
    const dispatcher = unsafePayload<Dispatcher>({
      handle: async (): Promise<ToolResponse<unknown>> => {
        dispatches += 1;
        return { ok: true, data: { capability: 'ok' } };
      },
    });
    const host = new SidecarHost(input.readable, output.writable, dispatcher, noopLog);

    input.emit({
      type: 'hello',
      version: 1,
      role: 'plugin',
      ts: 0,
    });
    assert.equal(readMessage(output.writes[0]).type, 'error');
    assert.equal(
      (readMessage(output.writes[0]).details as Record<string, unknown>).reason,
      'sidecar_peer_role_invalid',
    );

    input.emit({
      type: 'request',
      id: 'before-handshake',
      ts: 1,
      tool: 'list_capabilities',
      payload: {},
    });
    assert.equal(dispatches, 0);
    assert.equal(output.writes.length, 2);
    assert.equal(
      (readMessage(output.writes[1]).error as Record<string, unknown>).details &&
        (
          (readMessage(output.writes[1]).error as Record<string, unknown>).details as Record<
            string,
            unknown
          >
        ).reason,
      'sidecar_handshake_required',
    );

    input.emit({
      type: 'hello',
      version: 1,
      role: 'sidecar',
      ts: 2,
    });
    assert.equal(readMessage(output.writes[2]).type, 'ready');
    input.emit({
      type: 'request',
      id: 'after-handshake',
      ts: 3,
      tool: 'list_capabilities',
      payload: {},
    });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(dispatches, 1);
    assert.deepEqual(readMessage(output.writes[3]).data, { capability: 'ok' });
    host.dispose();
  })(),
);

registerAsync(
  (async () => {
    const input = createReadable();
    const output = createWritable();
    const dispatcher = unsafePayload<Dispatcher>({
      handle: async (): Promise<ToolResponse<unknown>> => ({
        ok: true,
        data: { value: 'x'.repeat(SIDECAR_IPC_MAX_FRAME_BYTES) },
      }),
    });
    const host = new SidecarHost(input.readable, output.writable, dispatcher, noopLog);
    input.emit({ type: 'hello', version: 1, role: 'sidecar', ts: 1 });
    input.emit({
      type: 'request',
      id: 'oversized-response',
      ts: 2,
      tool: 'list_capabilities',
      payload: {},
    });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(output.writes.length, 2);
    const response = readMessage(output.writes[1]);
    assert.equal(response.ok, false);
    assert.equal(
      ((response.error as Record<string, unknown>).details as Record<string, unknown>).reason,
      'sidecar_response_send_failed',
    );
    assert.ok(output.writes[1].length < SIDECAR_IPC_MAX_FRAME_BYTES);
    host.dispose();
  })(),
);

registerAsync(
  (async () => {
    const input = createReadable();
    const output = createWritable();
    let responseData: unknown = {
      project: { id: 'p1', dirty: undefined },
    };
    const dispatcher = unsafePayload<Dispatcher>({
      handle: async (): Promise<ToolResponse<unknown>> => ({
        ok: true,
        data: responseData,
      }),
    });
    const host = new SidecarHost(input.readable, output.writable, dispatcher, noopLog);
    input.emit({
      type: 'hello',
      version: 1,
      role: 'sidecar',
      ts: 1,
    });

    input.emit({
      type: 'request',
      id: 'optional-undefined',
      ts: 2,
      tool: 'list_capabilities',
      payload: {},
    });
    await Promise.resolve();
    await Promise.resolve();
    const normalized = readMessage(output.writes.at(-1) ?? '');
    assert.equal(normalized.ok, true);
    assert.deepEqual(normalized.data, { project: { id: 'p1' } });

    for (const id of ['non-finite', 'cyclic']) {
      if (id === 'non-finite') {
        responseData = { value: Number.NaN };
      } else {
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        responseData = cyclic;
      }
      input.emit({
        type: 'request',
        id,
        ts: 2,
        tool: 'list_capabilities',
        payload: {},
      });
      await Promise.resolve();
      await Promise.resolve();
      const response = readMessage(output.writes.at(-1) ?? '');
      assert.equal(response.ok, false);
      const error = response.error as Record<string, unknown>;
      assert.equal(
        (error.details as Record<string, unknown>).reason,
        'sidecar_response_contract_invalid',
      );
    }
    host.dispose();
  })(),
);

registerAsync(
  (async () => {
    const input = createReadable();
    const output = createWritable();
    const client = new SidecarClient(input.readable, output.writable, noopLog, { timeoutMs: 100 });

    input.emit({ type: 'ready', version: 1, ts: 0 });
    assert.equal(client.getStatus().ready, false);
    assert.equal(output.writes.length, 0);

    const beforeReady = await client.request('list_capabilities', {});
    assert.equal(beforeReady.ok, false);
    if (!beforeReady.ok) {
      assert.equal(beforeReady.error.details?.reason, 'sidecar_handshake_not_ready');
    }
    assert.equal(output.writes.length, 0);
    assert.equal(client.canAccept(), false);

    client.start();
    assert.equal(readMessage(output.writes[0]).type, 'hello');
    client.start();
    assert.equal(output.writes.length, 1);
    input.emit({ type: 'ready', version: 1, ts: 1 });
    assert.equal(client.getStatus().ready, true);
    assert.equal(client.canAccept(), true);

    const pending = client.request('list_capabilities', {});
    const request = readMessage(output.writes[1]);
    input.emit({
      type: 'response',
      id: String(request.id),
      ts: 2,
      ok: true,
      data: { capability: 'ok' },
    });
    assert.deepEqual(await pending, {
      ok: true,
      data: { capability: 'ok' },
    });
  })(),
);

registerAsync(
  (async () => {
    const input = createReadable();
    let writes = 0;
    const client = new SidecarClient(
      input.readable,
      {
        write: () => {
          writes += 1;
          throw new Error('write failed');
        },
      },
      noopLog,
    );
    client.start();
    client.start();
    assert.equal(writes, 2, 'failed hello writes must return to idle');
    assert.equal(client.getStatus().ready, false);
  })(),
);

registerAsync(
  (async () => {
    const input = createReadable();
    let writes = 0;
    const client = new SidecarClient(
      input.readable,
      {
        write: () => {
          writes += 1;
          if (writes > 1) throw new Error('request write failed');
        },
      },
      noopLog,
      { timeoutMs: 100 },
    );
    client.start();
    input.emit({ type: 'ready', version: 1, ts: 1 });
    const response = await client.request('list_capabilities', {});
    assert.equal(response.ok, false);
    if (!response.ok) {
      assert.equal(response.error.details?.reason, 'sidecar_request_send_failed');
    }
    assert.equal(client.getStatus().inFlight, 0);
  })(),
);
