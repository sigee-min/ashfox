import http from 'http';
import { SidecarClient } from './transport/SidecarClient';
import { StderrLogger } from './logger';
import { errorMessage } from '../logging';
import { McpRouter } from '../transport/mcp/router';
import { DEFAULT_TOOL_REGISTRY } from '../transport/mcp/tools';
import { createMcpHttpServer } from '../transport/mcp/httpServer';
import { PLUGIN_ID, PLUGIN_VERSION } from '../config';
import { GUIDE_RESOURCE_TEMPLATES, GUIDE_RESOURCES } from '../shared/resources/guides';
import { InMemoryResourceStore } from '../adapters/resources/resourceStore';
import { SIDECAR_TOOL_INSTRUCTIONS } from '../shared/tooling/toolInstructions';
import { ToolResponse } from '@ashfox/blockbench-contracts/types/internal';
import { resolveSidecarServerConfig } from './cliConfig';
import type { ServerConfig } from '../serverConfig';

const log = new StderrLogger('ashfox-sidecar', 'info');

const startSidecar = (config: ServerConfig): void => {
  const client = new SidecarClient(process.stdin, process.stdout, log);
  const resourceStore = new InMemoryResourceStore([...GUIDE_RESOURCE_TEMPLATES]);
  GUIDE_RESOURCES.forEach((resource) => resourceStore.put(resource));
  client.start();

  const executor = {
    callTool: async (name: string, args: unknown): Promise<ToolResponse<unknown>> => {
      const response = await client.requestValidated(name, args);
      return response;
    },
  };

  const router = new McpRouter(
    {
      path: config.path,
      token: config.token,
      endpoint: { host: config.host, port: config.port },
      serverInfo: { name: PLUGIN_ID, version: PLUGIN_VERSION },
      instructions: SIDECAR_TOOL_INSTRUCTIONS,
    },
    executor,
    log,
    resourceStore,
    DEFAULT_TOOL_REGISTRY,
  );

  const server = createMcpHttpServer(http, router, log);
  server.listen(config.port, config.host, () => {
    log.info('sidecar listening', { host: config.host, port: config.port, path: config.path });
  });
  server.on('error', (err) => {
    const message = errorMessage(err);
    log.error('sidecar server error', { message });
    process.exit(1);
  });

  process.on('SIGINT', () => {
    server.close(() => {
      log.info('sidecar stopped');
      process.exit(0);
    });
  });
};

const validation = resolveSidecarServerConfig(process.argv.slice(2), process.env);
if (!validation.ok) {
  log.error('invalid sidecar config', {
    reason: validation.reason,
    message: validation.message,
  });
  process.exitCode = 1;
} else {
  startSidecar(validation.config);
}
