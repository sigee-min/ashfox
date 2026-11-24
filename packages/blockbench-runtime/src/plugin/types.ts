import type { BlockbenchGlobals } from '../types/blockbench';
import type { ServerConfig, ServerConfigValidationReason } from '../serverConfig';

export type ReadGlobals = () => BlockbenchGlobals;

export type EndpointConfig = ServerConfig;

export type PublicEndpointConfig = Pick<ServerConfig, 'host' | 'port' | 'path'>;

export const toPublicEndpointConfig = (config: PublicEndpointConfig): PublicEndpointConfig => ({
  host: config.host,
  port: config.port,
  path: config.path,
});

export type RuntimeServerMode = 'starting' | 'inline' | 'sidecar' | 'stopped';

export type RuntimeServerStatusReason =
  | 'running'
  | 'starting'
  | 'inline_unavailable'
  | 'inline_start_failed'
  | 'sidecar_start_failed'
  | 'web_mode'
  | 'dispatcher_missing'
  | ServerConfigValidationReason;

export type RuntimeServerStatus = {
  mode: RuntimeServerMode;
  endpoint: PublicEndpointConfig;
  reason: RuntimeServerStatusReason;
};
