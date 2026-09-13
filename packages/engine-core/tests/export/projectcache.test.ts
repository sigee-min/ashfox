import assert from 'node:assert/strict';
import { snapshotAssetProject } from '../../src/export/pipeline/projectSnapshot';
import { exportProject } from './fixture';

const original = exportProject(undefined, 'immutable-export');
const first = snapshotAssetProject(original);
assert.equal(snapshotAssetProject(original), first,
  'A verified immutable project may reuse its exact export authority snapshot.');
assert.ok(Object.isFrozen(first.document.scene.nodes));

const mutable = { ...structuredClone(original), build: { ...original.build } };
const invalidHash = `sha256:${'0'.repeat(64)}` as const;
const mutableFirst = snapshotAssetProject(mutable);
assert.notEqual(snapshotAssetProject(mutable), mutableFirst,
  'Mutable callers must be snapshotted again even before their first edit.');
mutable.build.productHash = invalidHash;
assert.throws(() => snapshotAssetProject(mutable), /build identity do not agree/);

const shallow = Object.freeze(structuredClone(original));
snapshotAssetProject(shallow);
shallow.document.scene.nodes = {};
assert.throws(() => snapshotAssetProject(shallow), /document do not agree/,
  'A shallow freeze must not authorize a changed descendant.');
assert.ok(Object.keys(first.document.scene.nodes).length > 0);

let selected = original.document;
const accessor = { ...original };
Object.defineProperty(accessor, 'document', { enumerable: true, get: () => selected });
Object.freeze(accessor);
snapshotAssetProject(accessor);
selected = { ...original.document, scene: { ...original.document.scene, nodes: {} } };
assert.throws(() => snapshotAssetProject(accessor), /document do not agree/,
  'Frozen accessors can change values and must never enter the immutable cache.');

const forged = Object.freeze({ ...original,
  build: Object.freeze({ ...original.build, productHash: invalidHash }) });
assert.throws(() => snapshotAssetProject(forged), /build identity do not agree/,
  'Freezing a forgery does not provide an authority certificate.');
console.log('immutable export reuse preserves mutable, shallow-frozen and forged authority checks');

const proxyTarget = { ...original, build: original.build };
const freezingProxy = new Proxy(proxyTarget, {
  isExtensible(target) {
    if (Reflect.isExtensible(target)) {
      target.build = Object.freeze({ ...original.build, productHash: invalidHash });
      Object.freeze(target);
    }
    return Reflect.isExtensible(target);
  }
});
assert.throws(() => snapshotAssetProject(freezingProxy), /build identity do not agree/,
  'Immutability must be established before taking the snapshot, including proxy side effects.');
