import {
  Dispatcher,
  ToolName,
  ToolPayloadMap,
  ToolResponse,
} from '@ashfox/blockbench-contracts/types/internal';
import { errorMessage, Logger } from '../../logging';
import {
  PROTOCOL_VERSION,
  SidecarMessage,
  SidecarRequestMessage,
  SidecarResponseMessage,
  normalizeSidecarMessage,
} from '../../transport/protocol';
import { toolError } from '../../shared/tooling/toolResponse';
import {
  attachIpcReadable,
  createIpcDecoder,
  detachIpcReadable,
  IpcReadable,
  IpcWritable,
  sendIpcMessage,
} from './ipc';

type DispatcherToolName = ToolName;
type DispatcherPayload = ToolPayloadMap[ToolName];

export class SidecarHost {
  private readonly readable: IpcReadable;
  private readonly writable: IpcWritable;
  private readonly dispatcher: Dispatcher;
  private readonly log: Logger;
  private readonly onData: (chunk: string | Uint8Array) => void;
  private negotiated = false;

  constructor(readable: IpcReadable, writable: IpcWritable, dispatcher: Dispatcher, log: Logger) {
    this.readable = readable;
    this.writable = writable;
    this.dispatcher = dispatcher;
    this.log = log;
    const { onData } = createIpcDecoder(this.log, (message) => this.handleMessage(message));
    this.onData = onData;

    attachIpcReadable(this.readable, this.onData, this.log, {
      onEnd: () => this.log.warn('sidecar ipc stream ended'),
    });
  }

  send(message: SidecarMessage): boolean {
    return sendIpcMessage(this.writable, message, this.log);
  }

  dispose() {
    detachIpcReadable(this.readable, this.onData);
  }

  private handleMessage(message: SidecarMessage) {
    if (message.type === 'hello') {
      if (message.role !== 'sidecar') {
        this.send({
          type: 'error',
          ts: Date.now(),
          message: 'Sidecar host expected a sidecar peer role.',
          details: { reason: 'sidecar_peer_role_invalid' },
        });
        return;
      }
      this.negotiated = true;
      this.send({ type: 'ready', version: PROTOCOL_VERSION, ts: Date.now() });
      return;
    }
    if (message.type !== 'request') return;
    if (!this.negotiated) {
      this.sendContractFailure(
        message.id,
        'sidecar_handshake_required',
        'Sidecar v1 handshake is required before tool requests.',
      );
      return;
    }
    void this.handleRequest(message);
  }

  private async handleRequest(message: SidecarRequestMessage) {
    if (!message.id) {
      this.log.warn('sidecar request missing id');
      return;
    }
    let result: ToolResponse<unknown>;
    try {
      result = await this.dispatcher.handle(
        message.tool as DispatcherToolName,
        message.payload as DispatcherPayload,
      );
    } catch (err) {
      const msg = errorMessage(err, 'handler error');
      const response: SidecarResponseMessage = {
        type: 'response',
        id: message.id,
        ts: Date.now(),
        ok: false,
        error: toolError('unknown', msg, {
          reason: 'sidecar_handler_exception',
          tool: message.tool,
        }),
      };
      this.send(response);
      return;
    }

    const extensions = {
      ...(result.content ? { content: result.content } : {}),
      ...(result.structuredContent !== undefined
        ? { structuredContent: result.structuredContent }
        : {}),
      ...(result.nextActions ? { nextActions: result.nextActions } : {}),
    };
    const candidate: unknown = result.ok
      ? {
          type: 'response',
          id: message.id,
          ts: Date.now(),
          ok: true,
          data: result.data,
          ...extensions,
        }
      : {
          type: 'response',
          id: message.id,
          ts: Date.now(),
          ok: false,
          error: result.error,
          ...extensions,
        };
    const response = normalizeSidecarMessage(candidate);
    if (!response || response.type !== 'response') {
      this.log.warn('sidecar dispatcher returned an invalid v1 response', {
        tool: message.tool,
      });
      this.sendContractFailure(
        message.id,
        'sidecar_response_contract_invalid',
        'Sidecar dispatcher returned data outside the closed v1 contract.',
      );
      return;
    }
    if (!this.send(response)) {
      this.sendContractFailure(
        message.id,
        'sidecar_response_send_failed',
        'Sidecar response could not be sent within the v1 transport contract.',
      );
    }
  }

  private sendContractFailure(id: string, reason: string, message: string): void {
    const response: SidecarResponseMessage = {
      type: 'response',
      id,
      ts: Date.now(),
      ok: false,
      error: toolError('invalid_state', message, { reason }),
    };
    this.send(response);
  }
}
