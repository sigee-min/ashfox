import { encodeSseComment } from './sse';
import { SseConnection } from './types';

type SseAdapter = {
  send: (payload: string) => void;
  close: () => void;
  onClose: (handler: () => void) => void;
};

export const openSseConnection = (
  adapter: SseAdapter,
  onOpen?: (conn: SseConnection) => void | (() => void),
): SseConnection => {
  let closed = false;
  const keepAliveMs = 15_000;
  let cleanup: void | (() => void);
  let timer: ReturnType<typeof setInterval> | null = null;

  const connection: SseConnection = {
    send: (payload) => {
      if (closed) return;
      adapter.send(payload);
    },
    close: () => {
      if (closed) return;
      closed = true;
      if (cleanup) cleanup();
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      adapter.close();
    },
    isClosed: () => closed,
  };

  timer = setInterval(() => {
    if (closed) return;
    adapter.send(encodeSseComment('keepalive'));
  }, keepAliveMs);

  adapter.onClose(() => connection.close());
  if (onOpen) {
    try {
      const nextCleanup = onOpen(connection);
      if (closed && nextCleanup) {
        nextCleanup();
      } else {
        cleanup = nextCleanup;
      }
    } catch (err) {
      connection.close();
    }
  }
  return connection;
};
