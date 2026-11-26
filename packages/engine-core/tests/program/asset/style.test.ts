import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readWorkspaceFile } from '../../../src/project/container/codec';
import { compileAssetWorkspaceEntry } from '../../../src/compiler/program/asset/compile';

// Approved Lv4 Hytale showroom rebuild: articulated anatomy, painterly surfaces, and three clips per creature.
// Hashes cover canonical geometry, all texture recipe/raster data, and all authored animation channels.
const baseline = {
  fox: 'sha256:3b778386581ed43ed92024b4909d45ee0dd3cbe4443c72351328064569927058',
  goblin: 'sha256:ff2359e78ba39ebdd0a47a9f09299cca712c25c09f369176ccb56737d771d198',
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
    packageName: 'creatures',
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
const rejected = compileAssetWorkspaceEntry(stale, { packageName: 'creatures', entryName: 'fox' });
assert.equal(
  rejected.ok,
  false,
  'The previous compiler lock must not be accepted by a compatibility path',
);
