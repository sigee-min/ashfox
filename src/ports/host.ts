import { ToolError } from '../types';

export interface HostPort {
  schedulePluginReload(delayMs: number): ToolError | null;
}


