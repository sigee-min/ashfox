import type { Capabilities } from '../types';
import type { ProjectSession } from '../session';
import type { Logger } from '../logging';
import { BlockbenchEditor } from '../adapters/blockbench/BlockbenchEditor';
import { BlockbenchHost } from '../adapters/blockbench/BlockbenchHost';
import { BlockbenchFormats } from '../adapters/blockbench/BlockbenchFormats';
import { BlockbenchSnapshot } from '../adapters/blockbench/BlockbenchSnapshot';
import { BlockbenchExport } from '../adapters/blockbench/BlockbenchExport';
import { BlockbenchTextureRenderer } from '../adapters/blockbench/BlockbenchTextureRenderer';
import { LocalTmpStore } from '../adapters/tmp/LocalTmpStore';
import { ToolService } from '../usecases/ToolService';

export const buildDefaultToolService = (
  session: ProjectSession,
  capabilities: Capabilities,
  log: Logger
): ToolService => {
  const editor = new BlockbenchEditor(log);
  const host = new BlockbenchHost();
  const formats = new BlockbenchFormats();
  const snapshot = new BlockbenchSnapshot(log);
  const exporter = new BlockbenchExport(log);
  const textureRenderer = new BlockbenchTextureRenderer();
  const tmpStore = new LocalTmpStore();
  return new ToolService({
    session,
    capabilities,
    editor,
    host,
    formats,
    snapshot,
    exporter,
    textureRenderer,
    tmpStore,
    policies: { snapshotPolicy: 'hybrid', exportPolicy: 'strict' }
  });
};
