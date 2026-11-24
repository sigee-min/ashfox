import { openAssetProject } from '../../src';
import type { AssetProject } from '../../src/project/asset';
import { VALID_ASSET_SOURCE, validAssetWorkspace } from '../program/asset/fixture';

/** Open the smallest complete asset authority used by export contract tests. */
export const exportProject = (source = VALID_ASSET_SOURCE, id = 'export-project'): AssetProject => {
  const opened = openAssetProject({
    workspace: validAssetWorkspace(source),
    entry: { packageName: 'wolf', entryName: 'wolf' },
    identity: {
      id,
      revision: 'revision-1',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  });
  if (!opened.ok) {
    throw new Error(opened.diagnostics[0]?.message ?? 'Export asset fixture failed to open.');
  }
  return opened.project;
};
