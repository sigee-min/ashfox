import type { ServerConfig } from '../serverConfig';

export type SidecarLaunchConfig = ServerConfig & {
  execPath?: string;
};
