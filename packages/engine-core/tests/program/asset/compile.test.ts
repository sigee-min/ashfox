import assert from 'node:assert/strict';

import {
  compileAssetWorkspaceEntry,
  isAssetProjectAuthorityValid,
  openAssetProject,
} from '../../../src';
import { validAssetWorkspace } from './fixture';

const selector = Object.freeze({ packageName: 'wolf', entryName: 'wolf' });
const first = compileAssetWorkspaceEntry(validAssetWorkspace(), selector);
const second = compileAssetWorkspaceEntry(validAssetWorkspace(), selector);
assert.equal(first.ok, true, first.ok ? '' : first.diagnostics.map((item) => item.code).join(', '));
assert.equal(
  second.ok,
  true,
  second.ok ? '' : second.diagnostics.map((item) => item.code).join(', '),
);
if (first.ok && second.ok) {
  assert.deepEqual(Object.keys(first).sort(), ['build', 'model', 'ok']);
  assert.deepEqual(first, second, 'same workspace entry must compile byte-identically');
  assert.equal(first.model.textureDensity, 16);
  assert.deepEqual(first.model.textureResolution, [16, 8]);
  assert.equal(Object.keys(first.model.scene.nodes).length, 2);
  assert.equal(Object.keys(first.model.textures).length, 1);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.model));
  assert.ok(Object.isFrozen(first.model.scene.nodes));
  assert.match(first.build.productHash, /^sha256:[0-9a-f]{64}$/u);
}

const opened = openAssetProject({
  workspace: validAssetWorkspace(),
  entry: selector,
  identity: {
    id: 'project:wolf',
    revision: 'revision:1',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
});
assert.equal(
  opened.ok,
  true,
  opened.ok ? '' : opened.diagnostics.map((item) => item.code).join(', '),
);
if (opened.ok) {
  assert.deepEqual(Object.keys(opened.project).sort(), [
    'build',
    'createdAt',
    'document',
    'entry',
    'id',
    'revision',
    'updatedAt',
    'workspace',
  ]);
  assert.ok(Object.isFrozen(opened.project));
  assert.ok(Object.isFrozen(opened.project.workspace));
  assert.equal(isAssetProjectAuthorityValid(opened.project), true);
  assert.equal(
    isAssetProjectAuthorityValid({
      ...opened.project,
      build: {
        ...opened.project.build,
        workspaceHash: `sha256:${'0'.repeat(64)}`,
      },
    }),
    false,
    'build identity must agree with the exact workspace authority',
  );
  assert.equal(
    isAssetProjectAuthorityValid({
      ...opened.project,
      document: { ...opened.project.document, name: 'forged' },
    }),
    false,
    'derived document must agree with the exact selected entry build',
  );
}

const invalid = compileAssetWorkspaceEntry(validAssetWorkspace('ashfox 1\nmodel wolf {'), selector);
assert.equal(invalid.ok, false);
if (!invalid.ok) {
  assert.deepEqual(Object.keys(invalid).sort(), ['diagnostics', 'ok']);
  assert.ok(invalid.diagnostics[0]?.source?.path === 'wolf/main.ashfox');
}

const hostileWorkspace = new Proxy(validAssetWorkspace(), {
  get(target, property, receiver) {
    if (property === 'manifest') throw new Error('hostile getter');
    return Reflect.get(target, property, receiver);
  },
});
const hostile = compileAssetWorkspaceEntry(hostileWorkspace, selector);
assert.equal(hostile.ok, false, 'public compilation must contain hostile object access');
if (!hostile.ok) {
  assert.deepEqual(Object.keys(hostile).sort(), ['diagnostics', 'ok']);
  assert.deepEqual(
    hostile.diagnostics.map((item) => item.code),
    ['asset.compiler-failure'],
  );
}

const openUnknownKey = openAssetProject({
  workspace: validAssetWorkspace(),
  entry: selector,
  identity: {
    id: 'project:wolf',
    revision: 'revision:1',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  extra: true,
} as never);
assert.equal(openUnknownKey.ok, false, 'asset project input must reject unknown top-level keys');

const selectorUnknownKey = compileAssetWorkspaceEntry(validAssetWorkspace(), {
  ...selector,
  extra: true,
} as never);
assert.equal(selectorUnknownKey.ok, false, 'entry selection must reject unknown keys');

console.log('asset workspace entry compilation ok');
