import type { BlockbenchGlobals } from '../types/blockbench';

export type ReadGlobals = () => BlockbenchGlobals;

export type EndpointConfig = {
  host: string;
  port: number;
  path: string;
};

export type RuntimeServerMode = 'inline' | 'sidecar' | 'stopped';

export type RuntimeServerStatusReason =
  | 'running'
  | 'inline_unavailable'
  | 'sidecar_start_failed'
  | 'web_mode'
  | 'dispatcher_missing';

export type RuntimeServerStatus = {
  mode: RuntimeServerMode;
  endpoint: EndpointConfig;
  reason: RuntimeServerStatusReason;
};


