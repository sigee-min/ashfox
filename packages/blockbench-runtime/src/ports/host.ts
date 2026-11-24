import { ToolError } from '@ashfox/blockbench-contracts/types/internal';

export interface HostPort {
  schedulePluginReload(delayMs: number): ToolError | null;
}
