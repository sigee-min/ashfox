import type { Socket } from 'net';

import { errorMessage, type Logger } from '../../logging';
import {
  MCP_INVALID_HEADER,
  MCP_PAYLOAD_READ_FAILED,
  MCP_PAYLOAD_TOO_LARGE,
  MCP_REQUEST_TIMEOUT,
  MCP_TOOL_EXECUTION_FAILED,
} from '../../shared/messages';
import { ByteAccumulator } from '../byteAccumulator';
import {
  MCP_HTTP_MAX_HEADER_BYTES,
  TRANSPORT_MAX_PAYLOAD_BYTES,
  TRANSPORT_REQUEST_TIMEOUT_MS,
} from '../limits';
import { decodeStrictUtf8 } from '../utf8';
import {
  netJsonResponse,
  parseRequestHead,
  writeNetResponse,
  type ParsedRequestHead,
} from './netProtocol';
import type { McpRouter } from './router';
import type { ResponsePlan, SseConnection } from './types';

export interface McpNetConnectionOptions {
  readonly requestTimeoutMs?: number;
}

interface RoutedRequest {
  readonly head: ParsedRequestHead;
  readonly body: string;
}

interface PendingSseResponse {
  readonly open: (connection: SseConnection) => void | (() => void);
  readonly cancel: () => void;
  readonly isPending: () => boolean;
}

export const acceptMcpNetConnection = (
  socket: Socket,
  options: McpNetConnectionOptions,
  router: McpRouter,
  log: Logger,
): void => {
  new McpNetConnectionSession(socket, options, router, log).start();
};

class McpNetConnectionSession {
  private readonly buffer = new ByteAccumulator();
  private readonly requestTimeoutMs: number;
  private closed = false;
  private handedOff = false;
  private processing = false;
  private pendingHead: ParsedRequestHead | null = null;
  private cancelPendingSse: (() => void) | null = null;
  private requestTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly socket: Socket,
    options: McpNetConnectionOptions,
    private readonly router: McpRouter,
    private readonly log: Logger,
  ) {
    this.requestTimeoutMs = normalizedRequestTimeout(options.requestTimeoutMs);
  }

  start(): void {
    this.armRequestDeadline();
    this.socket.on('data', (chunk: Buffer) => this.receive(chunk));
    this.socket.on('error', (error: unknown) => {
      this.log.warn('MCP net socket error', { message: errorMessage(error) });
      this.closeSocket();
    });
    this.socket.on('close', () => this.release());
  }

  private receive(chunk: Buffer): void {
    if (this.closed || this.handedOff) return;
    if (
      this.buffer.length + chunk.length >
      TRANSPORT_MAX_PAYLOAD_BYTES + MCP_HTTP_MAX_HEADER_BYTES
    ) {
      this.closeSocket();
      return;
    }
    this.buffer.append(chunk);
    if (this.headerExceedsLimit()) {
      this.closeSocket();
      return;
    }
    void this.processBuffer();
  }

  private headerExceedsLimit(): boolean {
    if (this.pendingHead) return false;
    const headerEnd = this.buffer.indexOf('\r\n\r\n');
    return (
      (headerEnd < 0 && this.buffer.length > MCP_HTTP_MAX_HEADER_BYTES) ||
      (headerEnd >= 0 && headerEnd + 4 > MCP_HTTP_MAX_HEADER_BYTES)
    );
  }

  private async processBuffer(): Promise<void> {
    if (this.processing || this.closed) return;
    this.processing = true;
    try {
      while (!this.closed) {
        const request = this.readRequest();
        if (!request) return;
        if (!(await this.routeRequest(request))) return;
      }
    } finally {
      this.processing = false;
    }
  }

  private readRequest(): RoutedRequest | null {
    if (!this.readHead()) return null;
    const head = this.pendingHead;
    if (!head || this.buffer.length < head.contentLength) return null;
    this.pendingHead = null;
    const body = decodeStrictUtf8(this.buffer.take(head.contentLength));
    if (body === null) {
      this.respondAndClose(400, 'invalid_payload', MCP_PAYLOAD_READ_FAILED);
      return null;
    }
    return { head, body };
  }

  private readHead(): boolean {
    if (this.pendingHead) return true;
    const headerEnd = this.buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) return false;
    if (headerEnd + 4 > MCP_HTTP_MAX_HEADER_BYTES) {
      this.closeSocket();
      return false;
    }
    const headText = decodeStrictUtf8(this.buffer.view(0, headerEnd));
    if (headText === null) {
      this.respondAndClose(400, 'invalid_payload', MCP_INVALID_HEADER);
      return false;
    }
    const parsed = parseRequestHead(headText);
    if (!parsed.ok) {
      this.respondAndClose(400, 'invalid_payload', parsed.message);
      return false;
    }
    if (parsed.value.contentLength > TRANSPORT_MAX_PAYLOAD_BYTES) {
      this.respondAndClose(413, 'payload_too_large', MCP_PAYLOAD_TOO_LARGE);
      return false;
    }
    this.buffer.consume(headerEnd + 4);
    this.pendingHead = parsed.value;
    return true;
  }

  private async routeRequest(request: RoutedRequest): Promise<boolean> {
    const plan = await this.requestPlan(request);
    if (!plan) return false;
    if (this.closed) {
      if (plan.kind === 'sse') plan.onCancel?.();
      return false;
    }
    const pendingSse = this.preparePendingSse(plan);
    try {
      const wroteResponse = writeNetResponse(this.socket, plan, {
        closeAfter: request.head.shouldClose,
        onOpen: pendingSse?.open,
        canOpen: () => !this.closed,
      });
      if (!wroteResponse) {
        pendingSse?.cancel();
        this.closeSocket();
        return false;
      }
    } catch (error) {
      pendingSse?.cancel();
      this.log.error('MCP net response failed', {
        message: errorMessage(error, MCP_TOOL_EXECUTION_FAILED),
      });
      this.closeSocket();
      return false;
    }
    if (pendingSse?.isPending()) pendingSse.cancel();
    return this.finishResponse(plan, request.head.shouldClose);
  }

  private async requestPlan(request: RoutedRequest): Promise<ResponsePlan | null> {
    try {
      return await this.router.handle({
        method: request.head.method,
        url: request.head.url,
        headers: request.head.headers,
        body: request.body,
      });
    } catch (error) {
      if (this.closed) return null;
      this.log.error('MCP net request failed', {
        message: errorMessage(error, MCP_TOOL_EXECUTION_FAILED),
      });
      this.respondAndClose(500, 'unknown', MCP_TOOL_EXECUTION_FAILED);
      return null;
    }
  }

  private preparePendingSse(plan: ResponsePlan): PendingSseResponse | null {
    if (plan.kind !== 'sse' || !plan.onCancel) return null;
    let state: 'pending' | 'opened' | 'cancelled' = 'pending';
    const cancel = () => {
      if (state !== 'pending') return;
      state = 'cancelled';
      if (this.cancelPendingSse === cancel) this.cancelPendingSse = null;
      plan.onCancel?.();
    };
    const open = (connection: SseConnection) => {
      if (state !== 'pending') {
        connection.close();
        return undefined;
      }
      state = 'opened';
      if (this.cancelPendingSse === cancel) this.cancelPendingSse = null;
      try {
        return plan.onOpen?.(connection);
      } catch (error) {
        plan.onCancel?.();
        connection.close();
        return undefined;
      }
    };
    this.cancelPendingSse = cancel;
    return { open, cancel, isPending: () => state === 'pending' };
  }

  private finishResponse(plan: ResponsePlan, shouldClose: boolean): boolean {
    if (plan.kind === 'sse') {
      this.clearRequestDeadline();
      this.buffer.clear();
      if (plan.close) this.closed = true;
      else this.handedOff = true;
      return false;
    }
    if (shouldClose) {
      this.closeSocket();
      return false;
    }
    this.armRequestDeadline();
    return true;
  }

  private respondAndClose(status: number, code: string, message: string): void {
    try {
      writeNetResponse(
        this.socket,
        netJsonResponse(status, {
          error: { code, message },
        }),
        { closeAfter: true },
      );
    } finally {
      this.closeSocket();
    }
  }

  private armRequestDeadline(): void {
    this.clearRequestDeadline();
    this.requestTimer = setTimeout(() => {
      this.log.warn('MCP net request timed out', {
        message: MCP_REQUEST_TIMEOUT,
      });
      this.closeSocket();
    }, this.requestTimeoutMs);
  }

  private clearRequestDeadline(): void {
    if (!this.requestTimer) return;
    clearTimeout(this.requestTimer);
    this.requestTimer = null;
  }

  private closeSocket(): void {
    if (this.closed) return;
    this.closed = true;
    this.cancelPendingSse?.();
    this.cancelPendingSse = null;
    this.clearRequestDeadline();
    try {
      this.socket.end();
    } catch (error) {
      this.socket.destroy();
    }
  }

  private release(): void {
    this.closed = true;
    this.cancelPendingSse?.();
    this.cancelPendingSse = null;
    this.clearRequestDeadline();
    this.buffer.clear();
  }
}

const normalizedRequestTimeout = (value: number | undefined): number =>
  Number.isFinite(value) && (value ?? 0) > 0
    ? Math.trunc(value as number)
    : TRANSPORT_REQUEST_TIMEOUT_MS;
