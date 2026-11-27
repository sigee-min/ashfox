import * as http from 'node:http';
import type { DevViewerState } from '@ashfox/render-core';
import { renderDevViewerHtml } from './viewer';

export interface DevServerHandle {
  readonly port: number;
  readonly url: string;
  readonly setState: (next: DevViewerState) => void;
  readonly close: () => Promise<void>;
}

const sendJson = (res: http.ServerResponse, status: number, body: unknown): void => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
};

const handleInspectRequest = (url: URL, state: DevViewerState, res: http.ServerResponse): void => {
  const symbol = url.searchParams.get('symbol');
  const id = url.searchParams.get('id');
  if (!symbol && !id) {
    sendJson(res, 200, { revision: state.revision, entry: state.entry, refs: state.inspectRefs });
    return;
  }
  const match = state.inspectRefs.find(
    (ref) => (symbol && ref.symbol === symbol) || (id && ref.id === id),
  );
  if (!match) {
    sendJson(res, 404, { ok: false, message: 'Inspect reference not found' });
    return;
  }
  sendJson(res, 200, { revision: state.revision, entry: state.entry, ref: match });
};

const createRequestHandler =
  (
    html: string,
    getState: () => DevViewerState,
    sseClients: Set<http.ServerResponse>,
  ): http.RequestListener =>
  (req, res) => {
    const reqUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
    const state = getState();
    if (reqUrl.pathname === '/') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(html);
      return;
    }
    if (reqUrl.pathname === '/api/state') {
      sendJson(res, 200, state);
      return;
    }
    if (reqUrl.pathname === '/api/inspect') {
      handleInspectRequest(reqUrl, state, res);
      return;
    }
    if (reqUrl.pathname === '/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(`data: ${JSON.stringify({ kind: 'ready', revision: state.revision })}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  };

export const startDevServer = async (
  requestedPort: number,
  initialState: DevViewerState,
): Promise<DevServerHandle> => {
  let state = initialState;
  const sseClients = new Set<http.ServerResponse>();
  const server = http.createServer(
    createRequestHandler(renderDevViewerHtml(), () => state, sseClients),
  );
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(requestedPort, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : requestedPort;
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    setState: (next) => {
      state = next;
      const msg = `data: ${JSON.stringify({ kind: 'update', revision: next.revision })}\n\n`;
      for (const client of sseClients) client.write(msg);
    },
    close: async () => {
      for (const client of sseClients) client.end();
      sseClients.clear();
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};
