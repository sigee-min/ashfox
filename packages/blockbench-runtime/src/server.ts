import { Dispatcher } from '@ashfox/blockbench-contracts/types/internal';
import { errorMessage, Logger } from './logging';
import { PLUGIN_ID, PLUGIN_VERSION } from './config';
import { SERVER_TOOL_INSTRUCTIONS } from './shared/tooling/toolInstructions';
import { McpRouter } from './transport/mcp/router';
import { LocalToolExecutor } from './transport/mcp/executor';
import { createMcpHttpServer } from './transport/mcp/httpServer';
import { startMcpNetServer } from './transport/mcp/netServer';
import { ResourceStore } from './ports/resources';
import type { ToolRegistry } from './transport/mcp/tools';
import {
  SERVER_HTTP_PERMISSION_MESSAGE,
  SERVER_NET_PERMISSION_DETAIL,
  SERVER_NET_PERMISSION_MESSAGE,
  SERVER_NO_TRANSPORT,
} from './shared/messages';
import { loadNativeModule } from './shared/nativeModules';
import { validateServerConfig } from './serverConfig';
import type { ServerConfig } from './serverConfig';
import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'http';
import type { Server as NetServer, Socket } from 'net';
import type { TransportServerHandle } from './transport/serverLifecycle';

export { validateServerConfig } from './serverConfig';
export type { ServerConfig } from './serverConfig';

type HttpModule = {
  createServer: (
    options: { maxHeaderSize: number },
    handler: (req: IncomingMessage, res: ServerResponse) => void,
  ) => HttpServer;
};

type NetModule = {
  createServer: (handler: (socket: Socket) => void) => NetServer;
};

const startHttpServer = (
  http: HttpModule,
  config: ServerConfig,
  router: McpRouter,
  log: Logger,
): TransportServerHandle | null => {
  const server = createMcpHttpServer(http, router, log);
  let startSettled = false;
  let resolveReady: () => void = () => undefined;
  let rejectReady: (err: unknown) => void = () => undefined;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  server.on('error', (err: unknown) => {
    if (startSettled) return;
    startSettled = true;
    rejectReady(err);
  });
  try {
    server.listen(config.port, config.host, () => {
      if (!startSettled) {
        startSettled = true;
        resolveReady();
      }
      log.info('MCP server started (http)', {
        host: config.host,
        port: config.port,
        path: config.path,
      });
    });
  } catch (err) {
    log.error('MCP server failed to start (http)', { message: errorMessage(err) });
    startSettled = true;
    resolveReady();
    return null;
  }
  let stopped = false;
  return {
    ready,
    stop: () => {
      if (stopped) return;
      stopped = true;
      server.close();
      log.info('MCP server stopped (http)');
    },
  };
};

export function startServer(
  rawConfig: ServerConfig,
  dispatcher: Dispatcher,
  log: Logger,
  resources?: ResourceStore,
  toolRegistry?: ToolRegistry,
): TransportServerHandle | null {
  const validation = validateServerConfig(rawConfig);
  if (!validation.ok) {
    log.error('MCP server config invalid', {
      reason: validation.reason,
      message: validation.message,
    });
    return null;
  }

  const config = validation.config;
  const executor = new LocalToolExecutor(dispatcher);
  const router = new McpRouter(
    {
      path: config.path,
      token: config.token,
      endpoint: { host: config.host, port: config.port },
      serverInfo: { name: PLUGIN_ID, version: PLUGIN_VERSION },
      instructions: SERVER_TOOL_INSTRUCTIONS,
    },
    executor,
    log,
    resources,
    toolRegistry,
  );

  const http = loadNativeModule<HttpModule>('http', {
    message: SERVER_HTTP_PERMISSION_MESSAGE,
    optional: true,
  });
  if (http && typeof http.createServer === 'function') {
    const stop = startHttpServer(http, config, router, log);
    if (stop) return stop;
  }

  const net = loadNativeModule<NetModule>('net', {
    message: SERVER_NET_PERMISSION_MESSAGE,
    detail: SERVER_NET_PERMISSION_DETAIL,
    optional: false,
  });
  if (net && typeof net.createServer === 'function') {
    try {
      return startMcpNetServer(net, { host: config.host, port: config.port }, router, log);
    } catch (err) {
      log.error('MCP server failed to start (net)', {
        message: errorMessage(err),
      });
    }
  }

  log.warn(SERVER_NO_TRANSPORT);
  return null;
}
