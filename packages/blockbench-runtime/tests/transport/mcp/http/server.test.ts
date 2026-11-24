import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import type { McpRouter } from '../../../../src/transport/mcp/router';
import { createMcpHttpServer } from '../../../../src/transport/mcp/httpServer';
import {
  MCP_MAX_TRANSPORT_CONNECTIONS,
  TRANSPORT_MAX_PAYLOAD_BYTES,
  TRANSPORT_REQUEST_TIMEOUT_MS,
} from '../../../../src/transport/limits';
import { noopLog, registerAsync, unsafePayload } from '../../../helpers';

type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

const createHttpHarness = (router: McpRouter) => {
  let handler: RequestHandler | undefined;
  let maxHeaderSize = 0;
  const server = Object.assign(new EventEmitter(), {
    headersTimeout: 60_000,
    requestTimeout: 300_000,
    listen: () => server,
    close: () => server,
  });
  const created = createMcpHttpServer(
    {
      createServer: (options, nextHandler) => {
        maxHeaderSize = options.maxHeaderSize;
        handler = nextHandler;
        return server as unknown as Server;
      },
    },
    router,
    noopLog,
  );
  return { created, handler, maxHeaderSize, server };
};

const createRequest = () => {
  const request = Object.assign(new EventEmitter(), {
    method: 'POST',
    url: '/mcp',
    headers: { 'content-type': 'application/json' },
    complete: false,
    destroyCalls: 0,
    destroy() {
      this.destroyCalls += 1;
    },
  });
  return request;
};

const createResponse = () => {
  const events = new EventEmitter();
  const response = Object.assign(events, {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: '',
    ended: false,
    setHeader(key: string, value: string) {
      this.headers[key] = value;
    },
    write(value: string | Uint8Array) {
      this.body += typeof value === 'string' ? value : Buffer.from(value).toString('utf8');
      return true;
    },
    end(value?: string | Uint8Array) {
      if (value !== undefined) this.write(value);
      this.ended = true;
      events.emit('finish');
    },
    destroy() {
      this.ended = true;
    },
  });
  return response;
};

registerAsync(
  (async () => {
    let observedBody = '';
    let shouldThrow = false;
    const router = unsafePayload<McpRouter>({
      handle: async (request: { body?: string }) => {
        if (shouldThrow) throw new Error('router failed');
        observedBody = request.body ?? '';
        return { kind: 'empty', status: 204, headers: {} };
      },
    });
    const { created, handler, maxHeaderSize, server } = createHttpHarness(router);
    assert.equal(maxHeaderSize, 16 * 1024);
    assert.equal(created.headersTimeout, TRANSPORT_REQUEST_TIMEOUT_MS);
    assert.equal(created.requestTimeout, TRANSPORT_REQUEST_TIMEOUT_MS);
    assert.equal(created.maxConnections, MCP_MAX_TRANSPORT_CONNECTIONS);
    assert.doesNotThrow(() => server.emit('error', new Error('listen failed')));

    const request = createRequest();
    const response = createResponse();
    handler?.(unsafePayload<IncomingMessage>(request), unsafePayload<ServerResponse>(response));
    const body = Buffer.from('{"x":"😀"}', 'utf8');
    const emojiStart = body.indexOf(0xf0);
    request.emit('data', body.subarray(0, emojiStart + 2));
    request.emit('data', body.subarray(emojiStart + 2));
    request.complete = true;
    request.emit('end');
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(observedBody, '{"x":"😀"}');
    assert.equal(response.ended, true);

    shouldThrow = true;
    const failingRequest = createRequest();
    const failingResponse = createResponse();
    handler?.(
      unsafePayload<IncomingMessage>(failingRequest),
      unsafePayload<ServerResponse>(failingResponse),
    );
    failingRequest.complete = true;
    failingRequest.emit('end');
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(failingResponse.statusCode, 500);
    assert.equal(failingResponse.ended, true);
    assert.equal(failingResponse.body.includes('tool execution failed'), true);

    shouldThrow = false;
    const invalidRequest = createRequest();
    const invalidResponse = createResponse();
    handler?.(
      unsafePayload<IncomingMessage>(invalidRequest),
      unsafePayload<ServerResponse>(invalidResponse),
    );
    invalidRequest.emit('data', Buffer.from([0xc3, 0x28]));
    invalidRequest.complete = true;
    invalidRequest.emit('end');
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(invalidResponse.statusCode, 400);
    assert.equal(invalidRequest.destroyCalls, 1);

    const oversizedRequest = createRequest();
    const oversizedResponse = createResponse();
    handler?.(
      unsafePayload<IncomingMessage>(oversizedRequest),
      unsafePayload<ServerResponse>(oversizedResponse),
    );
    oversizedRequest.emit('data', Buffer.alloc(TRANSPORT_MAX_PAYLOAD_BYTES + 1));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(oversizedResponse.statusCode, 413);
    assert.equal(oversizedResponse.ended, true);
    assert.equal(oversizedRequest.destroyCalls, 1);
  })(),
);

registerAsync(
  (async () => {
    const pending: {
      resolve?: (plan: import('../../../../src/transport/mcp/types').ResponsePlan) => void;
    } = {};
    let cancelCalls = 0;
    const { handler } = createHttpHarness(
      unsafePayload<McpRouter>({
        handle: () =>
          new Promise((resolve) => {
            pending.resolve = resolve;
          }),
      }),
    );
    const request = createRequest();
    const response = createResponse();
    handler?.(unsafePayload<IncomingMessage>(request), unsafePayload<ServerResponse>(response));
    request.complete = true;
    request.emit('end');
    await Promise.resolve();
    response.emit('close');
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
    assert.equal(response.body, '');
  })(),
);
