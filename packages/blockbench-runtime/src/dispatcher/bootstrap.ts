import type { Capabilities } from '@ashfox/blockbench-contracts/types/internal';
import type { ProjectSession } from '../session';
import type { Logger } from '../logging';
import { BlockbenchEditor } from '../adapters/blockbench/editor';
import { BlockbenchHost } from '../adapters/blockbench/host';
import { BlockbenchFormats } from '../adapters/blockbench/formats';
import { BlockbenchSnapshot } from '../adapters/blockbench/snapshot';
import { BlockbenchTextureRenderer } from '../adapters/blockbench/texture/renderer';
import { BlockbenchViewportRefresher } from '../adapters/blockbench/viewport/refresh';
import { LocalTmpStore } from '../adapters/tmp/LocalTmpStore';
import { ToolService } from '../usecases/ToolService';

export const buildDefaultToolService = (
  session: ProjectSession,
  capabilities: Capabilities,
  log: Logger,
): ToolService => {
  const editor = new BlockbenchEditor(log);
  const host = new BlockbenchHost();
  const formats = new BlockbenchFormats();
  const snapshot = new BlockbenchSnapshot(log);
  const textureRenderer = new BlockbenchTextureRenderer();
  const viewportRefresher = new BlockbenchViewportRefresher(log);
  const tmpStore = new LocalTmpStore();
  return new ToolService({
    session,
    capabilities,
    editor,
    host,
    formats,
    snapshot,
    textureRenderer,
    viewportRefresher,
    tmpStore,
    policies: { snapshotPolicy: 'hybrid' },
  });
};
