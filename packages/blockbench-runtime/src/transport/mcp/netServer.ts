import type { Server, Socket } from 'net';

import { errorMessage, type Logger } from '../../logging';
import { MCP_MAX_TRANSPORT_CONNECTIONS } from '../limits';
import type { TransportServerHandle } from '../serverLifecycle';
import { acceptMcpNetConnection } from './netConnection';

export interface NetServerConfig {
  readonly host: string;
  readonly port: number;
  readonly requestTimeoutMs?: number;
}

interface NetModule {
  readonly createServer: (handler: (socket: Socket) => void) => Server;
}

export const startMcpNetServer = (
  net: NetModule,
  config: NetServerConfig,
  router: import('./router').McpRouter,
  log: Logger,
): TransportServerHandle => {
  const server = net.createServer((socket) => {
    acceptMcpNetConnection(socket, config, router, log);
  });
  server.maxConnections = MCP_MAX_TRANSPORT_CONNECTIONS;
  const readiness = serverReadiness(server, config, log);
  let stopped = false;
  return {
    ready: readiness.ready,
    stop: () => {
      if (stopped) return;
      stopped = true;
      server.close();
      log.info('MCP server stopped (net)');
    },
  };
};

interface ServerReadiness {
  readonly ready: Promise<void>;
}

const serverReadiness = (server: Server, config: NetServerConfig, log: Logger): ServerReadiness => {
  let settled = false;
  let resolveReady: () => void = () => undefined;
  let rejectReady: (error: unknown) => void = () => undefined;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  server.on('error', (error: unknown) => {
    log.error('MCP net server error', { message: errorMessage(error) });
    if (settled) return;
    settled = true;
    rejectReady(error);
  });
  try {
    server.listen(config.port, config.host, () => {
      if (!settled) {
        settled = true;
        resolveReady();
      }
      log.info('MCP server started (net)', {
        host: config.host,
        port: config.port,
      });
    });
  } catch (error) {
    settled = true;
    rejectReady(error);
  }
  return { ready };
};
