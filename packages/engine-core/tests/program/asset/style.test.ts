import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readWorkspaceFile } from '../../../src/project/container/codec';
import { compileAssetWorkspaceEntry } from '../../../src/compiler/program/asset/compile';

// Approved Lv4 Hytale showroom rebuild: articulated anatomy, painterly surfaces, and three clips per creature.
// Hashes cover canonical geometry, all texture recipe/raster data, and all authored animation channels.
const baseline = {
  red_fox: 'sha256:2e4c29c7d457b8c43a7ab10abc1277323c5640278cfa216e8da3aa9e2e6ae80c',
  goblin_raider: 'sha256:f84f5a6dedde48d568039dad9b97148261b16305243245fc8c7554cd65fcfb88',
};
const source = readFileSync(
  resolve(__dirname, '../../../../../assets/workspaces/shared-creatures.ashfoxworkspace'),
  'utf8',
);
const read = readWorkspaceFile(source);
assert.equal(read.ok, true);
if (!read.ok) throw new Error('Showcase workspace failed to open.');
for (const [entryName, hash] of Object.entries(baseline)) {
  const result = compileAssetWorkspaceEntry(read.workspace, {
    packageName: 'models',
    entryName,
  });
  assert.equal(
    result.ok,
    true,
    result.ok ? '' : result.diagnostics.map((item) => item.message).join('\n'),
  );
  if (result.ok)
    assert.equal(
      result.build.productHash,
      hash,
      entryName + ' changed its established visual product',
    );
}
const stale = {
  ...read.workspace,
  lock: {
    ...read.workspace.lock,
    compilerFingerprint: 'ashfox-asset-compiler:workspace+typed-hir+instantiation+canonical:v1',
  },
};
const rejected = compileAssetWorkspaceEntry(stale, {
  packageName: 'models',
  entryName: 'red_fox',
});
assert.equal(
  rejected.ok,
  false,
  'The previous compiler lock must not be accepted by a compatibility path',
);
