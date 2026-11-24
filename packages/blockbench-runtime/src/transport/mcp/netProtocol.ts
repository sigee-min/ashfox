import type { Socket } from 'net';

import {
  MCP_INVALID_CONTENT_LENGTH,
  MCP_INVALID_HEADER,
  MCP_INVALID_REQUEST_LINE,
  MCP_TRANSFER_ENCODING_UNSUPPORTED,
} from '../../shared/messages';
import { openSseConnection } from './transport';
import type { ResponsePlan, SseConnection } from './types';

const STATUS_TEXT: Readonly<Record<number, string>> = {
  200: 'OK',
  202: 'Accepted',
  400: 'Bad Request',
  401: 'Unauthorized',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  500: 'Internal Server Error',
};

export interface ParsedRequestHead {
  readonly method: string;
  readonly url: string;
  readonly version: string;
  readonly headers: Record<string, string>;
  readonly contentLength: number;
  readonly shouldClose: boolean;
}

export type RequestHeadResult =
  | { readonly ok: true; readonly value: ParsedRequestHead }
  | { readonly ok: false; readonly message: string };

export const parseRequestHead = (head: string): RequestHeadResult => {
  const lines = head.split('\r\n');
  const requestLine = /^([A-Z]+) (\S+) (HTTP\/1\.[01])$/.exec(lines[0]);
  if (!requestLine) {
    return { ok: false, message: MCP_INVALID_REQUEST_LINE };
  }
  const [, method, url, version] = requestLine;
  const headers: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const match = /^([!#$%&'*+\-.^_`|~0-9A-Za-z]+):[ \t]*(.*)$/.exec(line);
    if (!match) return { ok: false, message: MCP_INVALID_HEADER };
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (key === 'content-length' && Object.prototype.hasOwnProperty.call(headers, key)) {
      return { ok: false, message: MCP_INVALID_CONTENT_LENGTH };
    }
    headers[key] = headers[key] ? `${headers[key]}, ${value}` : value;
  }
  if (Object.prototype.hasOwnProperty.call(headers, 'transfer-encoding')) {
    return { ok: false, message: MCP_TRANSFER_ENCODING_UNSUPPORTED };
  }
  const contentLength = parseContentLength(headers);
  if (contentLength === null) {
    return { ok: false, message: MCP_INVALID_CONTENT_LENGTH };
  }
  const connection = headers.connection?.toLowerCase();
  const shouldClose =
    connection === 'close' || (version === 'HTTP/1.0' && connection !== 'keep-alive');
  return {
    ok: true,
    value: { method, url, version, headers, contentLength, shouldClose },
  };
};

const parseContentLength = (headers: Readonly<Record<string, string>>): number | null => {
  if (!Object.prototype.hasOwnProperty.call(headers, 'content-length')) {
    return 0;
  }
  const raw = headers['content-length'];
  if (!/^[0-9]+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

const writeHeaders = (
  socket: Socket,
  status: number,
  headers: Readonly<Record<string, string>>,
  hasBody: boolean,
): void => {
  const statusText = STATUS_TEXT[status] ?? 'OK';
  const lines = [`HTTP/1.1 ${status} ${statusText}`];
  for (const [key, value] of Object.entries(headers)) {
    lines.push(`${key}: ${value}`);
  }
  if (!hasBody) lines.push('Content-Length: 0');
  lines.push('', '');
  socket.write(lines.join('\r\n'));
};

export interface NetResponseOptions {
  readonly closeAfter: boolean;
  readonly onOpen?: (connection: SseConnection) => void | (() => void);
  readonly canOpen?: () => boolean;
}

export const writeNetResponse = (
  socket: Socket,
  plan: ResponsePlan,
  options: NetResponseOptions,
): boolean => {
  if (plan.kind === 'sse') {
    return writeSseResponse(socket, plan, options);
  }
  if (plan.kind === 'json') {
    const body = plan.body ?? '';
    writeHeaders(
      socket,
      plan.status,
      {
        ...plan.headers,
        'Content-Length': Buffer.byteLength(body).toString(),
      },
      true,
    );
    socket.write(body);
  } else if (plan.kind === 'binary') {
    const body = plan.body ?? new Uint8Array();
    writeHeaders(
      socket,
      plan.status,
      {
        ...plan.headers,
        'Content-Length': body.length.toString(),
      },
      true,
    );
    socket.write(body);
  } else {
    writeHeaders(socket, plan.status, plan.headers, false);
  }
  if (options.closeAfter) socket.end();
  return true;
};

const writeSseResponse = (
  socket: Socket,
  plan: Extract<ResponsePlan, { readonly kind: 'sse' }>,
  options: NetResponseOptions,
): boolean => {
  const headers: Record<string, string> = {
    ...plan.headers,
    Connection: 'close',
  };
  delete headers['Content-Length'];
  delete headers['Transfer-Encoding'];
  writeHeaders(socket, plan.status, headers, true);
  for (const event of plan.events) socket.write(event);
  if (plan.onOpen || !plan.close) {
    if (options.canOpen?.() === false) return false;
    openSseConnection(
      {
        send: (payload) => socket.write(payload),
        close: () => socket.end(),
        onClose: (handler) => socket.on('close', handler),
      },
      options.onOpen ?? plan.onOpen,
    );
    if (plan.close) socket.end();
    return true;
  }
  socket.end();
  return true;
};

export const netJsonResponse = (status: number, body: unknown): ResponsePlan => ({
  kind: 'json',
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
