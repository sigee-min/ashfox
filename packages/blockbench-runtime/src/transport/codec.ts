import { isSidecarMessage, type SidecarMessage } from './protocol';
import { utf8ContractByteLength } from '@ashfox/internal-contracts';
import { TRANSPORT_MAX_PAYLOAD_BYTES } from './limits';
import { createStrictUtf8Decoder } from './utf8';

export const SIDECAR_IPC_MAX_FRAME_BYTES = TRANSPORT_MAX_PAYLOAD_BYTES;

export type LineDecoder = {
  push: (chunk: string | Uint8Array) => void;
  end: () => void;
};

export const encodeMessage = (message: SidecarMessage): string => `${JSON.stringify(message)}\n`;

export const createLineDecoder = (
  onMessage: (message: SidecarMessage) => void,
  onError?: (err: Error) => void,
  maxFrameBytes = SIDECAR_IPC_MAX_FRAME_BYTES,
): LineDecoder => {
  const frameLimit =
    Number.isFinite(maxFrameBytes) && maxFrameBytes > 0
      ? Math.trunc(maxFrameBytes)
      : SIDECAR_IPC_MAX_FRAME_BYTES;
  let buffer = '';
  let bufferBytes = 0;
  let discardingOversizedFrame = false;
  let utf8Decoder = createStrictUtf8Decoder();

  const resetDecoder = (): void => {
    utf8Decoder = createStrictUtf8Decoder();
  };

  const decodeChunk = (chunk: string | Uint8Array): string | null => {
    if (typeof chunk === 'string') {
      const pending = utf8Decoder?.decode() ?? '';
      return `${pending}${chunk}`;
    }
    if (!utf8Decoder) {
      return null;
    }
    return utf8Decoder.decode(chunk, { stream: true });
  };

  const push = (chunk: string | Uint8Array) => {
    try {
      const decoded = decodeChunk(chunk);
      if (decoded === null) {
        buffer = '';
        bufferBytes = 0;
        discardingOversizedFrame = false;
        onError?.(new Error('sidecar ipc UTF-8 decoder unavailable'));
        return;
      }
      buffer += decoded;
      bufferBytes += utf8ContractByteLength(decoded);
    } catch (_error) {
      buffer = '';
      bufferBytes = 0;
      discardingOversizedFrame = false;
      resetDecoder();
      onError?.(new Error('sidecar ipc invalid UTF-8 stream'));
      return;
    }
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const rawLine = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      const frameBytes = utf8ContractByteLength(rawLine) + 1;
      bufferBytes = Math.max(0, bufferBytes - frameBytes);
      if (discardingOversizedFrame) {
        discardingOversizedFrame = false;
        newlineIndex = buffer.indexOf('\n');
        continue;
      }
      if (frameBytes > frameLimit) {
        onError?.(new Error('sidecar ipc frame overflow'));
        newlineIndex = buffer.indexOf('\n');
        continue;
      }
      const line = rawLine.trim();
      if (line.length > 0) {
        try {
          const parsed = JSON.parse(line) as unknown;
          if (!isSidecarMessage(parsed)) {
            onError?.(new Error('sidecar ipc invalid message'));
            continue;
          }
          onMessage(parsed);
        } catch (err) {
          onError?.(err instanceof Error ? err : new Error('sidecar ipc parse error'));
        }
      }
      newlineIndex = buffer.indexOf('\n');
    }
    if (discardingOversizedFrame) {
      buffer = '';
      bufferBytes = 0;
    } else if (bufferBytes > frameLimit) {
      buffer = '';
      bufferBytes = 0;
      discardingOversizedFrame = true;
      onError?.(new Error('sidecar ipc frame overflow'));
    }
  };

  const end = () => {
    try {
      utf8Decoder?.decode();
    } catch (_error) {
      onError?.(new Error('sidecar ipc invalid UTF-8 stream'));
    }
    buffer = '';
    bufferBytes = 0;
    discardingOversizedFrame = false;
    resetDecoder();
  };

  return { push, end };
};
