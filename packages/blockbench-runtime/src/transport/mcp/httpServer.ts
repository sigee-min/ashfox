import { errorMessage, Logger } from '../../logging';
import { McpRouter } from './router';
import { HttpRequest, ResponsePlan } from './types';
import { openSseConnection } from './transport';
import type { IncomingMessage, Server, ServerResponse } from 'http';
import {
  MCP_PAYLOAD_READ_FAILED,
  MCP_PAYLOAD_TOO_LARGE,
  MCP_REQUEST_ABORTED,
  MCP_REQUEST_CLOSED,
  MCP_REQUEST_ERROR,
  MCP_REQUEST_TIMEOUT,
  MCP_TOOL_EXECUTION_FAILED,
} from '../../shared/messages';
import {
  MCP_HTTP_MAX_HEADER_BYTES,
  MCP_MAX_TRANSPORT_CONNECTIONS,
  TRANSPORT_MAX_PAYLOAD_BYTES,
  TRANSPORT_REQUEST_TIMEOUT_MS,
} from '../limits';
import { decodeStrictUtf8 } from '../utf8';

type BodyErrorCode =
  'payload_too_large' | 'request_aborted' | 'request_timeout' | 'invalid_payload';

class BodyReadError extends Error {
  readonly code: BodyErrorCode;
  readonly status: number;

  constructor(code: BodyErrorCode, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const normalizeBodyError = (
  err: unknown,
): { status: number; code: BodyErrorCode; message: string } => {
  if (err instanceof BodyReadError) {
    return { status: err.status, code: err.code, message: err.message };
  }
  const message = errorMessage(err, MCP_PAYLOAD_READ_FAILED);
  return { status: 400, code: 'invalid_payload', message };
};

const normalizeHeaders = (headers: Record<string, string | string[] | undefined>) => {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (!value) continue;
    const lower = key.toLowerCase();
    normalized[lower] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return normalized;
};

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    let done = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      req.removeListener('aborted', onAborted);
      req.removeListener('close', onClose);
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    };

    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      cleanup();
      fn();
    };

    const fail = (error: BodyReadError) => finish(() => reject(error));

    const onData = (chunk: Buffer) => {
      const size = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
      total += size;
      if (total > TRANSPORT_MAX_PAYLOAD_BYTES) {
        fail(new BodyReadError('payload_too_large', 413, MCP_PAYLOAD_TOO_LARGE));
        return;
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    };

    const onEnd = () =>
      finish(() => {
        try {
          const bytes = Buffer.concat(chunks, total);
          const body = decodeStrictUtf8(bytes);
          if (body === null) {
            reject(new BodyReadError('invalid_payload', 400, MCP_PAYLOAD_READ_FAILED));
            return;
          }
          resolve(body);
        } catch (_error) {
          reject(new BodyReadError('invalid_payload', 400, MCP_PAYLOAD_READ_FAILED));
        }
      });

    const onError = (err: Error) => {
      const message = errorMessage(err, MCP_REQUEST_ERROR);
      fail(new BodyReadError('invalid_payload', 400, message));
    };

    const onAborted = () => {
      fail(new BodyReadError('request_aborted', 499, MCP_REQUEST_ABORTED));
    };

    const onClose = () => {
      if (done) return;
      if (!req.complete) {
        fail(new BodyReadError('request_aborted', 499, MCP_REQUEST_CLOSED));
      }
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('aborted', onAborted);
    req.on('close', onClose);

    timeout = setTimeout(() => {
      fail(new BodyReadError('request_timeout', 408, MCP_REQUEST_TIMEOUT));
    }, TRANSPORT_REQUEST_TIMEOUT_MS);
  });

const applyHeaders = (res: ServerResponse, headers: Record<string, string>) => {
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
};

const writePlan = (
  plan: ResponsePlan,
  res: ServerResponse,
  onOpen?: Extract<ResponsePlan, { kind: 'sse' }>['onOpen'],
  canOpen: () => boolean = () => true,
): boolean => {
  if (plan.kind === 'sse') {
    res.statusCode = plan.status;
    applyHeaders(res, plan.headers);
    for (const event of plan.events) {
      res.write(event);
    }
    if (plan.onOpen || !plan.close) {
      if (!canOpen()) {
        return false;
      }
      openSseConnection(
        {
          send: (payload) => res.write(payload),
          close: () => {
            try {
              res.end();
            } catch (err) {
              res.destroy?.();
            }
          },
          onClose: (handler) => res.on('close', handler),
        },
        onOpen ?? plan.onOpen,
      );
      if (plan.close) {
        res.end();
      }
      return true;
    }
    res.end();
    return true;
  }

  res.statusCode = plan.status;
  applyHeaders(res, plan.headers);
  if (plan.kind === 'json') {
    res.end(plan.body);
    return true;
  }
  if (plan.kind === 'binary') {
    res.end(plan.body);
    return true;
  }
  res.end();
  return true;
};

type HttpModule = {
  createServer: (
    options: { maxHeaderSize: number },
    handler: (req: IncomingMessage, res: ServerResponse) => void,
  ) => Server;
};

export const createMcpHttpServer = (http: HttpModule, router: McpRouter, log: Logger) => {
  const server = http.createServer(
    {
      maxHeaderSize: MCP_HTTP_MAX_HEADER_BYTES,
    },
    async (req: IncomingMessage, res: ServerResponse) => {
      let responseClosed = false;
      let cancelPendingSse: (() => void) | null = null;
      res.once('close', () => {
        responseClosed = true;
        cancelPendingSse?.();
        cancelPendingSse = null;
      });
      const method = req.method ?? 'GET';
      const url = req.url ?? '/';
      const headers = normalizeHeaders(req.headers ?? {});
      let body = '';
      if (method === 'POST') {
        try {
          body = await readBody(req);
        } catch (err) {
          const info = normalizeBodyError(err);
          log.warn('MCP HTTP payload rejected', { code: info.code, message: info.message });
          res.statusCode = info.status;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Connection', 'close');
          res.once('finish', () => req.destroy());
          try {
            res.end(JSON.stringify({ error: { code: info.code, message: info.message } }));
          } catch (err) {
            req.destroy();
            res.destroy?.();
          }
          return;
        }
      }

      let plan: ResponsePlan | null = null;
      try {
        plan = await router.handle({ method, url, headers, body } as HttpRequest);
        if (responseClosed || res.destroyed || res.writableEnded) {
          if (plan.kind === 'sse') plan.onCancel?.();
          return;
        }
        let sseState: 'pending' | 'opened' | 'cancelled' | null = null;
        let cancelSse: (() => void) | undefined;
        let openSse: Extract<ResponsePlan, { kind: 'sse' }>['onOpen'];
        if (plan.kind === 'sse' && plan.onCancel) {
          sseState = 'pending';
          cancelSse = () => {
            if (sseState !== 'pending') return;
            sseState = 'cancelled';
            if (cancelPendingSse === cancelSse) cancelPendingSse = null;
            plan?.kind === 'sse' && plan.onCancel?.();
          };
          openSse = (conn) => {
            if (sseState !== 'pending') {
              conn.close();
              return undefined;
            }
            sseState = 'opened';
            if (cancelPendingSse === cancelSse) cancelPendingSse = null;
            try {
              return plan?.kind === 'sse' ? plan.onOpen?.(conn) : undefined;
            } catch (err) {
              if (plan?.kind === 'sse') plan.onCancel?.();
              conn.close();
              return undefined;
            }
          };
          cancelPendingSse = cancelSse;
        }
        const wroteResponse = writePlan(
          plan,
          res,
          openSse,
          () => !responseClosed && !res.destroyed && !res.writableEnded,
        );
        if (!wroteResponse) {
          cancelSse?.();
          res.destroy?.();
          return;
        }
        if (sseState === 'pending') cancelSse?.();
      } catch (err) {
        cancelPendingSse?.();
        cancelPendingSse = null;
        log.error('MCP HTTP request failed', {
          message: errorMessage(err, MCP_TOOL_EXECUTION_FAILED),
        });
        if (responseClosed || res.destroyed || res.writableEnded || res.headersSent) {
          res.destroy?.();
          return;
        }
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        try {
          res.end(
            JSON.stringify({
              error: {
                code: 'unknown',
                message: MCP_TOOL_EXECUTION_FAILED,
              },
            }),
          );
        } catch (_writeError) {
          res.destroy?.();
        }
      }
    },
  );
  server.maxConnections = MCP_MAX_TRANSPORT_CONNECTIONS;
  server.headersTimeout = TRANSPORT_REQUEST_TIMEOUT_MS;
  server.requestTimeout = TRANSPORT_REQUEST_TIMEOUT_MS;
  server.on('error', (err: Error) => {
    log.error('MCP HTTP server error', {
      message: errorMessage(err, MCP_TOOL_EXECUTION_FAILED),
    });
  });
  return server;
};
