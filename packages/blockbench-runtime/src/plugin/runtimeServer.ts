import type { Dispatcher } from '@ashfox/blockbench-contracts/types/internal';
import type { LogLevel, Logger } from '../logging';
import { ConsoleLogger } from '../logging';
import type { ResourceStore } from '../ports/resources';
import type { ToolRegistry } from '../transport/mcp/tools';
import { startServer } from '../server';
import { validateServerConfig } from '../serverConfig';
import { SidecarProcess } from '../sidecar/SidecarProcess';
import type { SidecarLaunchConfig } from '../sidecar/types';
import { readGlobals } from '../adapters/blockbench/blockbenchUtils';
import { PLUGIN_ID } from '../config';
import {
  PLUGIN_LOG_INLINE_SERVER_UNAVAILABLE,
  PLUGIN_LOG_SERVER_WEB_MODE,
  PLUGIN_LOG_SIDECAR_FAILED,
} from './messages';
import { toPublicEndpointConfig, type EndpointConfig, type RuntimeServerStatus } from './types';
import type { TransportServerHandle } from '../transport/serverLifecycle';

type SidecarController = {
  start: () => boolean;
  stop: () => void;
};

export type RuntimeServerState = {
  sidecar: SidecarController | null;
  inlineServer: TransportServerHandle | null;
  status: RuntimeServerStatus;
};

const makeStatus = (
  endpointConfig: EndpointConfig,
  mode: RuntimeServerStatus['mode'],
  reason: RuntimeServerStatus['reason'],
): RuntimeServerStatus => ({
  mode,
  reason,
  endpoint: toPublicEndpointConfig(endpointConfig),
});

export const createRuntimeServerState = (endpointConfig: EndpointConfig): RuntimeServerState => ({
  sidecar: null,
  inlineServer: null,
  status: makeStatus(endpointConfig, 'stopped', 'dispatcher_missing'),
});

export const restartServer = (args: {
  endpointConfig: EndpointConfig;
  dispatcher: Dispatcher | null;
  logLevel: LogLevel;
  resourceStore: ResourceStore;
  toolRegistry: ToolRegistry;
  state: RuntimeServerState;
  readGlobals?: typeof readGlobals;
  startInlineServer?: typeof startServer;
  createSidecar?: (
    endpoint: SidecarLaunchConfig,
    dispatcher: Dispatcher,
    logger: Logger,
  ) => SidecarController;
  loggerFactory?: () => Logger;
  onStatusChange?: (status: RuntimeServerStatus) => void;
}): RuntimeServerState => {
  let { sidecar, inlineServer } = args.state;
  if (sidecar) {
    sidecar.stop();
    sidecar = null;
  }
  if (inlineServer) {
    inlineServer.stop();
    inlineServer = null;
  }

  const logger = args.loggerFactory?.() ?? new ConsoleLogger(PLUGIN_ID, () => args.logLevel);
  const globals = (args.readGlobals ?? readGlobals)();
  const blockbench = globals.Blockbench;
  if (blockbench?.isWeb) {
    logger.warn(PLUGIN_LOG_SERVER_WEB_MODE);
    return {
      sidecar: null,
      inlineServer: null,
      status: makeStatus(args.endpointConfig, 'stopped', 'web_mode'),
    };
  }

  if (!args.dispatcher) {
    return {
      sidecar: null,
      inlineServer: null,
      status: makeStatus(args.endpointConfig, 'stopped', 'dispatcher_missing'),
    };
  }

  const validation = validateServerConfig(args.endpointConfig);
  if (!validation.ok) {
    logger.error('MCP server config invalid', {
      reason: validation.reason,
      message: validation.message,
    });
    return {
      sidecar: null,
      inlineServer: null,
      status: makeStatus(args.endpointConfig, 'stopped', validation.reason),
    };
  }
  const endpointConfig = validation.config;

  const startInlineServer = args.startInlineServer ?? startServer;
  const createSidecar =
    args.createSidecar ??
    ((endpoint: SidecarLaunchConfig, dispatcher: Dispatcher, log: Logger) =>
      new SidecarProcess(endpoint, dispatcher, log));

  const inlineHandle = startInlineServer(
    endpointConfig,
    args.dispatcher,
    logger,
    args.resourceStore,
    args.toolRegistry,
  );
  if (inlineHandle) {
    const nextState: RuntimeServerState = {
      sidecar: null,
      inlineServer: inlineHandle,
      status: makeStatus(endpointConfig, 'starting', 'starting'),
    };
    void inlineHandle.ready.then(
      () => {
        if (nextState.inlineServer !== inlineHandle) return;
        nextState.status = makeStatus(endpointConfig, 'inline', 'running');
        args.onStatusChange?.(nextState.status);
      },
      (err) => {
        if (nextState.inlineServer !== inlineHandle) return;
        inlineHandle.stop();
        nextState.inlineServer = null;
        nextState.status = makeStatus(endpointConfig, 'stopped', 'inline_start_failed');
        logger.error('MCP inline server failed to listen', {
          message: err instanceof Error ? err.message : String(err),
        });
        args.onStatusChange?.(nextState.status);
      },
    );
    return nextState;
  }
  logger.warn(PLUGIN_LOG_INLINE_SERVER_UNAVAILABLE);
  const endpoint: SidecarLaunchConfig = {
    ...endpointConfig,
  };
  sidecar = createSidecar(endpoint, args.dispatcher, logger);
  if (!sidecar.start()) {
    sidecar = null;
    logger.warn(PLUGIN_LOG_SIDECAR_FAILED);
    return {
      sidecar,
      inlineServer: null,
      status: makeStatus(endpointConfig, 'stopped', 'sidecar_start_failed'),
    };
  }
  return {
    sidecar,
    inlineServer: null,
    status: makeStatus(endpointConfig, 'sidecar', 'inline_unavailable'),
  };
};
