import { Logger } from '../../logging';
import {
  PROTOCOL_VERSION,
  SidecarMessage,
  SidecarRequestMessage,
  SidecarResponseMessage,
  isSidecarMessage,
} from '../../transport/protocol';
import {
  ToolPayloadMap,
  ToolResponse,
  ToolName,
} from '@ashfox/blockbench-contracts/types/internal';
import { normalizeToolResponse } from '../../shared/tooling/toolResponseGuard';
import { toolError } from '../../shared/tooling/toolResponse';
import { SIDECAR_INFLIGHT_LIMIT_REACHED } from '../../shared/messages';
import {
  attachIpcReadable,
  createIpcDecoder,
  IpcReadable,
  IpcWritable,
  sendIpcMessage,
} from './ipc';

type Pending = {
  resolve: (value: ToolResponse<unknown>) => void;
  reject: (err: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

type ClientOptions = {
  timeoutMs?: number;
  maxInFlight?: number;
};

export type SidecarClientStatus = {
  ready: boolean;
  inFlight: number;
  maxInFlight: number;
  protocolVersion: typeof PROTOCOL_VERSION | null;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_IN_FLIGHT = 64;

export class SidecarClient {
  private readonly readable: IpcReadable;
  private readonly writable: IpcWritable;
  private readonly log: Logger;
  private readonly timeoutMs: number;
  private readonly maxInFlight: number;
  private readonly pending = new Map<string, Pending>();
  private counter = 0;
  private phase: 'idle' | 'hello-sent' | 'ready' = 'idle';
  private protocolVersion: typeof PROTOCOL_VERSION | null = null;

  constructor(
    readable: IpcReadable,
    writable: IpcWritable,
    log: Logger,
    options: ClientOptions = {},
  ) {
    this.readable = readable;
    this.writable = writable;
    this.log = log;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxInFlight = options.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT;

    const { onData } = createIpcDecoder(this.log, (message) => this.handleMessage(message));
    attachIpcReadable(this.readable, onData, this.log);
  }

  start() {
    if (this.phase !== 'idle') {
      this.log.warn('sidecar ipc start ignored outside idle phase');
      return;
    }
    this.phase = 'hello-sent';
    this.protocolVersion = null;
    const sent = this.send({
      type: 'hello',
      version: PROTOCOL_VERSION,
      role: 'sidecar',
      ts: Date.now(),
    });
    if (!sent && this.phase === 'hello-sent') this.phase = 'idle';
  }

  canAccept(): boolean {
    return this.phase === 'ready' && this.pending.size < this.maxInFlight;
  }

  getStatus(): SidecarClientStatus {
    return {
      ready: this.phase === 'ready',
      inFlight: this.pending.size,
      maxInFlight: this.maxInFlight,
      protocolVersion: this.protocolVersion,
    };
  }

  request<TName extends ToolName>(
    tool: TName,
    payload: ToolPayloadMap[TName],
  ): Promise<ToolResponse<unknown>> {
    return this.requestValidated(tool, payload);
  }

  requestValidated(tool: unknown, payload: unknown): Promise<ToolResponse<unknown>> {
    if (this.phase !== 'ready') {
      return Promise.resolve({
        ok: false,
        error: toolError('invalid_state', 'Sidecar v1 handshake is not ready.', {
          reason: 'sidecar_handshake_not_ready',
        }),
      });
    }
    if (!this.canAccept()) {
      return Promise.resolve({
        ok: false,
        error: { code: 'invalid_state', message: SIDECAR_INFLIGHT_LIMIT_REACHED },
      });
    }

    const id = this.nextId();
    const candidate: unknown = {
      type: 'request',
      id,
      ts: Date.now(),
      tool,
      payload,
    };
    if (!isSidecarMessage(candidate) || candidate.type !== 'request') {
      return Promise.resolve({
        ok: false,
        error: toolError(
          'invalid_payload',
          'Sidecar request does not match the closed v1 tool contract.',
          { reason: 'sidecar_request_contract_invalid' },
        ),
      });
    }
    const message: SidecarRequestMessage = candidate;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('sidecar request timeout'));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timeoutId });
      if (!this.send(message) && this.pending.has(id)) {
        clearTimeout(timeoutId);
        this.pending.delete(id);
        resolve({
          ok: false,
          error: toolError('io_error', 'Sidecar request could not be written.', {
            reason: 'sidecar_request_send_failed',
          }),
        });
      }
    });
  }

  private nextId(): string {
    this.counter += 1;
    return `${Date.now()}_${this.counter}`;
  }

  private send(message: SidecarMessage): boolean {
    return sendIpcMessage(this.writable, message, this.log);
  }

  private handleMessage(message: SidecarMessage) {
    if (message.type === 'ready') {
      if (this.phase !== 'hello-sent') {
        this.log.warn('unsolicited sidecar ready message ignored');
        return;
      }
      this.phase = 'ready';
      this.protocolVersion = message.version ?? null;
      this.log.info('sidecar ipc ready', { version: message.version });
      return;
    }
    if (message.type === 'response') {
      this.resolveResponse(message);
      return;
    }
    if (message.type === 'error') {
      this.log.warn('sidecar ipc error', { message: message.message });
      return;
    }
  }

  private resolveResponse(message: SidecarResponseMessage) {
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timeoutId);
    this.pending.delete(message.id);

    if (message.ok) {
      const response = {
        ok: true,
        data: message.data,
        ...(message.content ? { content: message.content } : {}),
        ...(message.structuredContent !== undefined
          ? { structuredContent: message.structuredContent }
          : {}),
        ...(message.nextActions ? { nextActions: message.nextActions } : {}),
      };
      pending.resolve(
        normalizeToolResponse(response, { source: 'sidecar_client', ensureReason: true }),
      );
      return;
    }
    const response = {
      ok: false,
      error: message.error,
      ...(message.content ? { content: message.content } : {}),
      ...(message.structuredContent !== undefined
        ? { structuredContent: message.structuredContent }
        : {}),
      ...(message.nextActions ? { nextActions: message.nextActions } : {}),
    };
    pending.resolve(
      normalizeToolResponse(response, { source: 'sidecar_client', ensureReason: true }),
    );
  }
}
