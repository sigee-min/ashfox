import assert from 'node:assert/strict';

import {
  ASHFOX_WORKSPACE_FILE_CONTENT_TYPE,
  ASHFOX_WORKSPACE_FILE_EXTENSION,
  readWorkspaceFile,
  writeWorkspaceFile
} from '../../../src/project/container';
import type {
  AuthoredAssetWorkspace,
  Sha256Digest
} from '../../../src/project/workspace';
import {
  assetSource,
  workspaceFixture
} from '../workspace/fixtures';

const workspace = workspaceFixture([{
  path: 'dragon/main.ashfox',
  source: assetSource('dragon')
}]);

assert.equal(ASHFOX_WORKSPACE_FILE_EXTENSION, '.ashfoxworkspace');
assert.equal(
  ASHFOX_WORKSPACE_FILE_CONTENT_TYPE,
  'application/vnd.ashfox.workspace+json'
);

const written = writeWorkspaceFile(workspace);
assert.deepEqual(Object.keys(written).sort(), ['ok', 'source']);
assert.equal(written.ok, true);
if (!written.ok) throw new Error('valid workspace did not serialize');
assert.equal(written.source.endsWith('\n'), true);
assert.equal(written.source.endsWith('\n\n'), false);
assert.equal(written.source.includes('\r'), false);
assert.deepEqual(Object.keys(JSON.parse(written.source)).sort(), [
  'files', 'lock', 'manifest'
]);

const encoded = new TextEncoder().encode(written.source);
const readFromBytes = readWorkspaceFile(encoded);
assert.deepEqual(Object.keys(readFromBytes).sort(), ['ok', 'workspace']);
assert.equal(readFromBytes.ok, true);
if (!readFromBytes.ok) throw new Error('serialized workspace did not read');
const repeated = writeWorkspaceFile(readFromBytes.workspace);
assert.deepEqual(repeated, written,
  'writer output must be byte-identical after a read/write round trip');

const readFromText = readWorkspaceFile(written.source);
assert.equal(readFromText.ok, true);

const malformedJson = readWorkspaceFile('{"files":\n');
assert.deepEqual(Object.keys(malformedJson).sort(), ['diagnostics', 'ok']);
assert.equal(malformedJson.ok, false);
if (!malformedJson.ok) assert.equal(malformedJson.diagnostics[0]?.code,
  'workspace.file.json');

const oversized = readWorkspaceFile('x'.repeat(70_000), {
  limits: { maxSourceBytes: 1, maxFiles: 1, maxPathCodeUnits: 1 }
});
assert.equal(oversized.ok, false);
if (!oversized.ok) assert.equal(oversized.diagnostics[0]?.code,
  'workspace.file.budget');

for (const invalid of [
  null,
  undefined,
  42,
  new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]),
  new Uint8Array([0xc3, 0x28])
] as unknown[]) {
  const result = readWorkspaceFile(invalid as never);
  assert.equal(result.ok, false, 'invalid container input must fail closed');
}

for (const invalidText of [
  written.source.slice(0, -1),
  `${written.source}\n`,
  written.source.replace(/\n$/u, '\r\n'),
  JSON.stringify({ workspace: JSON.parse(written.source) }) + '\n',
  JSON.stringify({ ...JSON.parse(written.source), extra: true }) + '\n'
]) {
  const result = readWorkspaceFile(invalidText);
  assert.equal(result.ok, false,
    'noncanonical or wrapped workspace input must fail closed');
}

const stale = structuredClone(workspace);
const stalePackage = stale.lock.packages[0];
if (stalePackage === undefined) throw new Error('fixture lock is empty');
const staleWorkspace: AuthoredAssetWorkspace = {
  ...stale,
  lock: {
    ...stale.lock,
    packages: [{
      ...stalePackage,
      contentHash: `sha256:${'0'.repeat(64)}` as Sha256Digest
    }]
  }
};
const staleResult = writeWorkspaceFile(staleWorkspace);
assert.deepEqual(Object.keys(staleResult).sort(), ['diagnostics', 'ok']);
assert.equal(staleResult.ok, false);

console.log('portable workspace file reader/writer authority ok');
