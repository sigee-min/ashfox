import type { Dispatcher } from '@ashfox/contracts/types/internal';
import type { LogLevel, Logger } from '../logging';
import { ConsoleLogger } from '../logging';
import type { ResourceStore } from '../ports/resources';
import type { ToolRegistry } from '../transport/mcp/tools';
import { startServer } from '../server';
import { SidecarProcess } from '../sidecar/SidecarProcess';
import type { SidecarLaunchConfig } from '../sidecar/types';
import { readGlobals } from '../adapters/blockbench/blockbenchUtils';
import { PLUGIN_ID } from '../config';
import {
  PLUGIN_LOG_INLINE_SERVER_UNAVAILABLE,
  PLUGIN_LOG_SERVER_WEB_MODE,
  PLUGIN_LOG_SIDECAR_FAILED
} from './messages';
import type { EndpointConfig, RuntimeServerStatus } from './types';

type SidecarController = {
  start: () => boolean;
  stop: () => void;
};

export type RuntimeServerState = {
  sidecar: SidecarController | null;
  inlineServerStop: (() => void) | null;
  status: RuntimeServerStatus;
};

const makeStatus = (
  endpointConfig: EndpointConfig,
  mode: RuntimeServerStatus['mode'],
  reason: RuntimeServerStatus['reason']
): RuntimeServerStatus => ({
  mode,
  reason,
  endpoint: { ...endpointConfig }
});

export const createRuntimeServerState = (endpointConfig: EndpointConfig): RuntimeServerState => ({
  sidecar: null,
  inlineServerStop: null,
  status: makeStatus(endpointConfig, 'stopped', 'dispatcher_missing')
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
    logger: Logger
  ) => SidecarController;
  loggerFactory?: () => Logger;
}): RuntimeServerState => {
  let { sidecar, inlineServerStop } = args.state;
  if (sidecar) {
    sidecar.stop();
    sidecar = null;
  }
  if (inlineServerStop) {
    inlineServerStop();
    inlineServerStop = null;
  }

  const logger = args.loggerFactory?.() ?? new ConsoleLogger(PLUGIN_ID, () => args.logLevel);
  const globals = (args.readGlobals ?? readGlobals)();
  const blockbench = globals.Blockbench;
  if (blockbench?.isWeb) {
    logger.warn(PLUGIN_LOG_SERVER_WEB_MODE);
    return {
      sidecar: null,
      inlineServerStop: null,
      status: makeStatus(args.endpointConfig, 'stopped', 'web_mode')
    };
  }

  if (!args.dispatcher) {
    return {
      sidecar: null,
      inlineServerStop: null,
      status: makeStatus(args.endpointConfig, 'stopped', 'dispatcher_missing')
    };
  }

  const startInlineServer = args.startInlineServer ?? startServer;
  const createSidecar =
    args.createSidecar ??
    ((endpoint: SidecarLaunchConfig, dispatcher: Dispatcher, log: Logger) =>
      new SidecarProcess(endpoint, dispatcher, log));

  const inlineStop = startInlineServer(
    { host: args.endpointConfig.host, port: args.endpointConfig.port, path: args.endpointConfig.path },
    args.dispatcher,
    logger,
    args.resourceStore,
    args.toolRegistry
  );
  if (inlineStop) {
    inlineServerStop = inlineStop;
    return {
      sidecar: null,
      inlineServerStop,
      status: makeStatus(args.endpointConfig, 'inline', 'running')
    };
  }
  logger.warn(PLUGIN_LOG_INLINE_SERVER_UNAVAILABLE);
  const endpoint: SidecarLaunchConfig = {
    host: args.endpointConfig.host,
    port: args.endpointConfig.port,
    path: args.endpointConfig.path
  };
  sidecar = createSidecar(endpoint, args.dispatcher, logger);
  if (!sidecar.start()) {
    sidecar = null;
    logger.warn(PLUGIN_LOG_SIDECAR_FAILED);
    return {
      sidecar,
      inlineServerStop: null,
      status: makeStatus(args.endpointConfig, 'stopped', 'sidecar_start_failed')
    };
  }
  return {
    sidecar,
    inlineServerStop: null,
    status: makeStatus(args.endpointConfig, 'sidecar', 'inline_unavailable')
  };
};
