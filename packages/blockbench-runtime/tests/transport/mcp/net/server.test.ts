import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { Server, Socket } from 'node:net';

import type { McpRouter } from '../../../../src/transport/mcp/router';
import type { ResponsePlan, SseConnection } from '../../../../src/transport/mcp/types';
import { startMcpNetServer } from '../../../../src/transport/mcp/netServer';
import {
  MCP_HTTP_MAX_HEADER_BYTES,
  TRANSPORT_MAX_PAYLOAD_BYTES,
} from '../../../../src/transport/limits';
import { parseRequestHead } from '../../../../src/transport/mcp/netProtocol';
import { SIDECAR_IPC_MAX_FRAME_BYTES } from '../../../../src/transport/codec';
import { noopLog, registerAsync, unsafePayload } from '../../../helpers';

assert.equal(SIDECAR_IPC_MAX_FRAME_BYTES, TRANSPORT_MAX_PAYLOAD_BYTES);

{
  const parsed = parseRequestHead(
    ['POST /mcp HTTP/1.1', 'Host: localhost', 'Content-Length: 12', 'Connection: close'].join(
      '\r\n',
    ),
  );
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.contentLength, 12);
    assert.equal(parsed.value.shouldClose, true);
  }
}

for (const head of [
  'POST /mcp HTTP/1.1\r\nContent-Length: 1junk',
  'POST /mcp HTTP/1.1\r\nContent-Length:',
  'POST /mcp HTTP/1.1\r\nContent-Length: 1\r\nContent-Length: 1',
  'POST /mcp HTTP/1.1\r\nTransfer-Encoding: chunked',
  'POST /mcp HTTP/1.1 extra\r\nHost: localhost',
  'POST /mcp HTTP/1.1\r\nMalformed header',
]) {
  assert.equal(parseRequestHead(head).ok, false, head);
}

type FakeSocket = EventEmitter & {
  writes: Array<string | Uint8Array>;
  endCalls: number;
  lateWrites: number;
  write: (value: string | Uint8Array) => boolean;
  end: () => void;
  destroy: () => void;
};

const createSocket = (): FakeSocket => {
  const socket = Object.assign(new EventEmitter(), {
    writes: [] as Array<string | Uint8Array>,
    endCalls: 0,
    lateWrites: 0,
    write(value: string | Uint8Array) {
      if (this.endCalls > 0) this.lateWrites += 1;
      this.writes.push(value);
      return true;
    },
    end() {
      this.endCalls += 1;
    },
    destroy() {
      this.endCalls += 1;
    },
  });
  return socket;
};

{
  let accept: ((socket: Socket) => void) | undefined;
  const server = Object.assign(new EventEmitter(), {
    listen: (_port: number, _host: string, callback: () => void) => {
      callback();
      return server;
    },
    close: () => server,
  });
  const serverHandle = startMcpNetServer(
    {
      createServer: (handler) => {
        accept = handler;
        return server as unknown as Server;
      },
    },
    { host: '127.0.0.1', port: 0 },
    unsafePayload<McpRouter>({
      handle: async () => ({
        kind: 'empty',
        status: 204,
        headers: {},
      }),
    }),
    noopLog,
  );
  assert.notEqual(accept, undefined);

  const unterminated = createSocket();
  accept?.(unterminated as unknown as Socket);
  unterminated.emit('data', Buffer.alloc(MCP_HTTP_MAX_HEADER_BYTES + 1, 'x'));
  assert.equal(unterminated.endCalls, 1);

  const oversizedTerminated = createSocket();
  accept?.(oversizedTerminated as unknown as Socket);
  oversizedTerminated.emit(
    'data',
    Buffer.from(
      `GET /mcp HTTP/1.1\r\nX-Fill: ${'x'.repeat(MCP_HTTP_MAX_HEADER_BYTES)}\r\n\r\n`,
      'utf8',
    ),
  );
  assert.equal(oversizedTerminated.endCalls, 1);
  serverHandle.stop();
}

registerAsync(
  (async () => {
    let accept: ((socket: Socket) => void) | undefined;
    const server = Object.assign(new EventEmitter(), {
      listen: (_port: number, _host: string, callback: () => void) => {
        callback();
        return server;
      },
      close: () => server,
    });
    const serverHandle = startMcpNetServer(
      {
        createServer: (handler) => {
          accept = handler;
          return server as unknown as Server;
        },
      },
      { host: '127.0.0.1', port: 0, requestTimeoutMs: 5 },
      unsafePayload<McpRouter>({
        handle: async () => ({ kind: 'empty', status: 204, headers: {} }),
      }),
      noopLog,
    );

    const partialHeader = createSocket();
    accept?.(partialHeader as unknown as Socket);
    partialHeader.emit('data', Buffer.from('POST /mcp HTTP/1.1\r\n'));

    const partialBody = createSocket();
    accept?.(partialBody as unknown as Socket);
    partialBody.emit('data', Buffer.from('POST /mcp HTTP/1.1\r\nContent-Length: 10\r\n\r\nx'));

    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(partialHeader.endCalls, 1);
    assert.equal(partialBody.endCalls, 1);
    serverHandle.stop();
  })(),
);

registerAsync(
  (async () => {
    let accept: ((socket: Socket) => void) | undefined;
    const server = Object.assign(new EventEmitter(), {
      listen: (_port: number, _host: string, callback: () => void) => {
        callback();
        return server;
      },
      close: () => server,
    });
    let routerCalls = 0;
    let mode: 'slow' | 'sse' | 'open_sse' | 'throw' = 'slow';
    const openSse: { connection?: SseConnection } = {};
    const serverHandle = startMcpNetServer(
      {
        createServer: (handler) => {
          accept = handler;
          return server as unknown as Server;
        },
      },
      { host: '127.0.0.1', port: 0, requestTimeoutMs: 5 },
      unsafePayload<McpRouter>({
        handle: async () => {
          routerCalls += 1;
          if (mode === 'slow') {
            await new Promise((resolve) => setTimeout(resolve, 20));
            return { kind: 'empty', status: 204, headers: {} };
          }
          if (mode === 'throw') throw new Error('router failed');
          return mode === 'open_sse'
            ? {
                kind: 'sse',
                status: 200,
                headers: {
                  'Content-Type': 'text/event-stream',
                  Connection: 'keep-alive',
                },
                events: [': open\n\n'],
                close: false,
                onOpen: (connection: SseConnection) => {
                  openSse.connection = connection;
                },
              }
            : {
                kind: 'sse',
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
                events: ['event: done\ndata: {}\n\n'],
                close: true,
              };
        },
      }),
      noopLog,
    );

    const slowSocket = createSocket();
    accept?.(slowSocket as unknown as Socket);
    slowSocket.emit('data', Buffer.from('GET /mcp HTTP/1.1\r\nContent-Length: 0\r\n\r\n'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(slowSocket.endCalls, 1);
    assert.equal(slowSocket.lateWrites, 0);

    mode = 'sse';
    routerCalls = 0;
    const sseSocket = createSocket();
    accept?.(sseSocket as unknown as Socket);
    const request = 'GET /mcp HTTP/1.1\r\nContent-Length: 0\r\n\r\n';
    sseSocket.emit('data', Buffer.from(request + request));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(routerCalls, 1);
    assert.equal(sseSocket.endCalls, 1);
    assert.equal(sseSocket.lateWrites, 0);

    mode = 'open_sse';
    routerCalls = 0;
    const openSseSocket = createSocket();
    accept?.(openSseSocket as unknown as Socket);
    openSseSocket.emit('data', Buffer.from(request + request));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(routerCalls, 1);
    assert.equal(openSseSocket.endCalls, 0);
    assert.equal(
      openSseSocket.writes.some((value) => String(value).includes('Connection: close')),
      true,
    );
    assert.ok(openSse.connection);
    openSse.connection.send('event: update\ndata: {}\n\n');
    assert.equal(
      openSseSocket.writes.some((value) => String(value).includes('event: update')),
      true,
    );
    openSse.connection.close();
    assert.equal(openSseSocket.endCalls, 1);

    mode = 'throw';
    const throwingSocket = createSocket();
    accept?.(throwingSocket as unknown as Socket);
    throwingSocket.emit('data', Buffer.from(request));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(
      throwingSocket.writes.some((value) => String(value).includes('500 Internal Server Error')),
      true,
    );
    assert.equal(throwingSocket.lateWrites, 0);
    serverHandle.stop();
  })(),
);

registerAsync(
  (async () => {
    let accept: ((socket: Socket) => void) | undefined;
    const server = Object.assign(new EventEmitter(), {
      listen: (_port: number, _host: string, callback: () => void) => {
        callback();
        return server;
      },
      close: () => server,
    });
    let routerCalls = 0;
    let observedBody = '';
    const serverHandle = startMcpNetServer(
      {
        createServer: (handler) => {
          accept = handler;
          return server as unknown as Server;
        },
      },
      { host: '127.0.0.1', port: 0, requestTimeoutMs: 1_000 },
      unsafePayload<McpRouter>({
        handle: async (request: { body?: string }) => {
          routerCalls += 1;
          observedBody = request.body ?? '';
          return { kind: 'empty', status: 204, headers: {} };
        },
      }),
      noopLog,
    );

    const invalidUtf8 = createSocket();
    accept?.(invalidUtf8 as unknown as Socket);
    invalidUtf8.emit(
      'data',
      Buffer.concat([
        Buffer.from('POST /mcp HTTP/1.1\r\nContent-Length: 2\r\n\r\n'),
        Buffer.from([0xc3, 0x28]),
      ]),
    );
    await Promise.resolve();
    assert.equal(routerCalls, 0);
    assert.equal(
      invalidUtf8.writes.some((value) => String(value).includes('400 Bad Request')),
      true,
    );

    const chunkedInput = createSocket();
    accept?.(chunkedInput as unknown as Socket);
    const body = 'x'.repeat(50_000);
    chunkedInput.emit(
      'data',
      Buffer.from(`POST /mcp HTTP/1.1\r\nContent-Length: ${body.length}\r\n\r\n`),
    );
    for (let index = 0; index < body.length; index += 1) {
      chunkedInput.emit('data', Buffer.from('x'));
    }
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(routerCalls, 1);
    assert.equal(observedBody, body);
    serverHandle.stop();
  })(),
);

registerAsync(
  (async () => {
    let accept: ((socket: Socket) => void) | undefined;
    const server = Object.assign(new EventEmitter(), {
      listen: (_port: number, _host: string, callback: () => void) => {
        callback();
        return server;
      },
      close: () => server,
    });
    const pending: { resolve?: (plan: ResponsePlan) => void } = {};
    let cancelCalls = 0;
    const serverHandle = startMcpNetServer(
      {
        createServer: (handler) => {
          accept = handler;
          return server as unknown as Server;
        },
      },
      { host: '127.0.0.1', port: 0, requestTimeoutMs: 1_000 },
      unsafePayload<McpRouter>({
        handle: () =>
          new Promise((resolve) => {
            pending.resolve = resolve;
          }),
      }),
      noopLog,
    );
    const disconnected = createSocket();
    accept?.(disconnected as unknown as Socket);
    disconnected.emit('data', Buffer.from('GET /mcp HTTP/1.1\r\nContent-Length: 0\r\n\r\n'));
    disconnected.emit('close');
    assert.ok(pending.resolve);
    pending.resolve({
      kind: 'sse',
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      events: [],
      close: false,
      onCancel: () => {
        cancelCalls += 1;
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(cancelCalls, 1);
    assert.equal(disconnected.writes.length, 0);
    serverHandle.stop();
  })(),
);
