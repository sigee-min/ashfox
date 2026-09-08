import assert from 'node:assert/strict';

import type { SourceSpan } from '../../../src/project/source/contract';
import type { AssetSymbolId } from '../../../src/compiler/program/asset/contract';
import type { AssetExactFrame } from '../../../src/compiler/program/asset/frame';
import type {
  InstantiatedAssetIr,
  InstantiatedComponentInstance,
  InstantiatedGeometryNode,
  InstantiatedGeometryProperty,
  InstantiatedSocketConnection
} from '../../../src/compiler/program/asset/ir';
import { lowerAssetGeometry } from '../../../src/compiler/program/asset/canonicalGeometry';
import type { AssetTexturePlan } from '../../../src/compiler/program/asset/texture/contract';
import {
  assetBooleanValue,
  assetExactNumber,
  assetNumberValue,
  assetVectorValue,
  type AssetNumberValue,
  type AssetValue
} from '../../../src/compiler/program/asset/value/contract';
import type { TextureAsset } from '../../../src/model/texture';

const span = (offset = 1): SourceSpan => Object.freeze({
  start: Object.freeze({ offset, line: 1, column: offset }),
  end: Object.freeze({ offset: offset + 1, line: 1, column: offset + 1 })
});

const number = (value: number, unit: 'unit' | 'degree' | 'plain' = 'unit'): AssetNumberValue =>
  assetNumberValue(assetExactNumber(BigInt(value), 1n, unit));

const rational = (numerator: bigint, denominator: bigint): AssetNumberValue =>
  assetNumberValue(assetExactNumber(numerator, denominator, 'unit'));

const vector = (
  values: readonly [number, number, number],
  type: 'vec3<unit>' | 'vec3<degree>' = 'vec3<unit>'
): AssetValue => assetVectorValue(values.map((value) => number(value,
  type === 'vec3<degree>' ? 'degree' : 'unit')), type);

const frame = (origin: readonly [number, number, number] = [0, 0, 0]): AssetExactFrame => Object.freeze({
  origin: Object.freeze(origin.map((value) => assetExactNumber(BigInt(value), 1n, 'unit'))) as AssetExactFrame['origin'],
  xAxis: Object.freeze([1, 0, 0]) as AssetExactFrame['xAxis'],
  yAxis: Object.freeze([0, 1, 0]) as AssetExactFrame['yAxis'],
  zAxis: Object.freeze([0, 0, 1]) as AssetExactFrame['zAxis'],
  determinant: 1
});

const symbol = (name: string, kind: AssetSymbolId['kind'] = 'surface'): AssetSymbolId => ({
  modulePath: 'root.ashfox', name, kind, key: `root:${kind}:${name}`
});

const property = (name: string, value: AssetValue, offset = 2): InstantiatedGeometryProperty => ({
  name, value, span: span(offset)
});

const geometry = (
  kind: InstantiatedGeometryNode['kind'],
  id: string,
  attachmentBoneId: string | null,
  properties: readonly InstantiatedGeometryProperty[] = [],
  children: readonly InstantiatedGeometryNode[] = [],
  surface: InstantiatedGeometryNode['surface'] = null
): InstantiatedGeometryNode => ({
  kind, id, attachmentBoneId, properties, surface, children,
  sourcePath: 'root.ashfox', span: span()
});

const skin = symbol('skin');
const planFor = (layout: 'box' | 'flat', width: number, height: number): AssetTexturePlan => {
  const texture: TextureAsset = {
    id: 'texture:skin', name: 'skin', width: 64, height: 64,
    source: { bucket: 'inline', key: 'skin.png', contentType: 'image/png', contentHash: 'sha256:test' },
    visible: true, sampling: 'nearest', colorSpace: 'srgb', renderMode: 'default', renderSides: 'auto'
  };
  return { surfaceSymbol: skin, texture, charts: {
    body: { id: 'body', layout, origin: [10, 20], width, height, coverage: null, span: span() }
  } };
};

const surfaceBinding = (material: 'opaque' | 'cutout' | 'double' = 'opaque') => ({
  surface: skin, contract: symbol('skinContract', 'surface-contract'), material,
  charts: ['body'], span: span()
});

const instance = (
  id: string,
  geometryNodes: readonly InstantiatedGeometryNode[],
  placementAuthority: 'rig' | 'socket' = 'rig'
): InstantiatedComponentInstance => ({
  id, component: symbol(id, 'component'), placementAuthority, placement: frame(), parameters: {},
  socketEndpoints: [], geometry: geometryNodes, sourcePath: 'root.ashfox', span: span()
});

const baseIr = (
  instances: readonly InstantiatedComponentInstance[],
  connections: InstantiatedAssetIr['connections'] = []
): InstantiatedAssetIr => ({
  asset: symbol('asset', 'asset'), settings: { density: assetNumberValue(assetExactNumber(1n, 1n, 'plain')), forward: 'north' },
  rig: symbol('rig', 'rig-contract'), skeleton: symbol('skeleton', 'skeleton'),
  bones: [{ id: 'root', semanticJoint: 'root', parentId: null, parentRestFrame: frame(), sourcePath: 'root.ashfox', span: span() }],
  instances, surfaces: [surfaceBinding()], connections, motions: [],
  budget: { limits: { instances: 1, bones: 1, nodes: 64, faces: 128, motionKeys: 1, diagnostics: 64 },
    used: { instances: 0, bones: 0, nodes: 0, faces: 0, motionKeys: 0, diagnostics: 0 } }
});

const boxSurface = { port: 'skin', chart: 'body', surface: skin, span: span() };

const issuesFor = (ir: InstantiatedAssetIr, plans: readonly AssetTexturePlan[]) => {
  const diagnostics: string[] = [];
  const product = lowerAssetGeometry(ir, plans, (_path, _span, code) => diagnostics.push(code));
  return { diagnostics, product };
};

{
  const faces = ['north', 'south', 'east', 'west', 'up', 'down'].map((direction) =>
    geometry('face', `body/cube/${direction}`, 'root', direction === 'north'
      ? [property('enabled', assetBooleanValue(false)), property('rotation', number(90, 'plain'))] : []));
  const cube = geometry('cube', 'body/cube', 'root', [
    property('origin', vector([1, 2, 3])), property('size', vector([2, 3, 4]))
  ], faces, boxSurface);
  const result = issuesFor(baseIr([instance('body', [cube])]), [planFor('box', 12, 7)]);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.product);
  if (result.product) {
    const lowered = result.product.nodes.find((node) => node.id === 'body/cube');
    assert.ok(lowered && lowered.kind === 'cube');
    if (lowered?.kind === 'cube') {
      assert.deepEqual(lowered.parentId, 'root');
      assert.deepEqual(lowered.bounds, { from: [1, 2, 3], to: [3, 5, 7] });
      assert.deepEqual(lowered.faces.north.uv, [14, 24, 16, 27]);
      assert.equal(lowered.faces.north.enabled, false);
      assert.equal(lowered.faces.north.rotation, 90);
      assert.deepEqual(lowered.faces.up.uv, [14, 20, 16, 24]);
      assert.equal(lowered.faces.north.textureId, 'texture:skin');
    }
  }
}

{
  const locator = geometry('locator', 'body/private/locator', 'body/private');
  const privateBone = geometry('bone', 'body/private', 'root', [
    property('position', vector([2, 0, 0])), property('visible', assetBooleanValue(false))
  ], [locator]);
  const result = issuesFor(baseIr([instance('body', [privateBone])]), []);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.product);
  if (result.product) {
    const nodes = new Map(result.product.nodes.map((node) => [node.id, node]));
    assert.equal(nodes.get('body/private')?.parentId, 'root');
    assert.equal(nodes.get('body/private/locator')?.parentId, 'body/private');
    assert.equal(nodes.get('body/private')?.visible, false);
  }
}

for (const rootOrigin of [[0, 0, 0], [10, 20, 30]] as const) {
  const anchor = geometry('bone', 'mount/anchor', null);
  const plate = geometry('cube', 'mount/anchor/plate', 'mount/anchor', [
    property('origin', vector([0, 0, 0])), property('size', vector([1, 1, 1]))
  ], [], boxSurface);
  const connection: InstantiatedSocketConnection = {
    id: 'skeleton.wing->mount.wing', fromInstance: 'skeleton', fromPort: 'wing',
    toInstance: 'mount', toPort: 'wing', targetBoneId: 'mount/anchor', parentBoneId: 'root',
    parentPlacement: frame([2, 0, 0]), span: span()
  };
  const ir = baseIr([instance('mount', [anchor, plate], 'socket')], [connection]);
  const result = issuesFor({ ...ir, bones: ir.bones.map((bone) => ({ ...bone,
    parentRestFrame: { ...frame(rootOrigin), xAxis: [0, 1, 0], yAxis: [-1, 0, 0] }
  })) }, [planFor('box', 4, 2)]);
  const expected = [rootOrigin[0] + 2, rootOrigin[1], rootOrigin[2]];
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.product);
  if (result.product) {
    const lowered = result.product.nodes.find((node) => node.id === 'mount/anchor');
    assert.ok(lowered && lowered.kind === 'bone');
    if (lowered?.kind === 'bone') {
      assert.equal(lowered.parentId, 'root');
      assert.deepEqual(lowered.transform.pivot, expected, 'parent rotation is applied by the hierarchy, not baked twice');
      const plate = result.product.nodes.find((node) => node.id === 'mount/anchor/plate');
      assert.ok(plate?.kind === 'cube' && plate.geometryMode === 'axis-box');
      assert.deepEqual(plate.bounds.from, expected, 'socket translation must move geometry, not just its hinge');
      assert.deepEqual(plate.transform.pivot, expected);
    }
  }
}

{
  const plane = geometry('plane', 'body/plane', 'root', [
    property('origin', vector([1, 2, 3])), property('size', assetVectorValue([
      number(4), number(2)
    ], 'vec2<unit>')), property('u-axis', vector([1, 0, 0])),
    property('v-axis', vector([0, 1, 0]))
  ], [], { port: 'skin', chart: 'body', surface: skin, span: span() });
  const ir = { ...baseIr([instance('body', [plane])]), surfaces: [surfaceBinding('double')] };
  const result = issuesFor(ir, [planFor('flat', 4, 2)]);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.product);
  if (result.product) {
    const lowered = result.product.nodes.find((node) => node.id === 'body/plane');
    assert.ok(lowered && lowered.kind === 'plane');
    if (lowered?.kind === 'plane') {
      assert.equal(lowered.sidedness, 'double');
      assert.equal(lowered.faces.back.enabled, true);
      assert.deepEqual(lowered.basis?.normal, [0, 0, 1]);
      assert.deepEqual(lowered.transform.position, [1, 2, 3]);
      assert.equal(lowered.coverageId, 'texture:skin\u0000body');
    }
  }
}

{
  const malformed = geometry('cube', 'body/cube', 'root', [
    property('origin', vector([0, 0, 0])), property('size', assetVectorValue([
      rational(1n, 2n), number(1), number(1)
    ], 'vec3<unit>'))
  ], [], boxSurface);
  const fractional = issuesFor(baseIr([instance('body', [malformed])]), [planFor('box', 4, 3)]);
  assert.equal(fractional.product, null);
  assert.ok(fractional.diagnostics.length > 0);

  const duplicate = issuesFor(baseIr([instance('body', [malformed, malformed])]), [planFor('box', 4, 3)]);
  assert.equal(duplicate.product, null);
  assert.ok(duplicate.diagnostics.includes('asset.duplicate-emitted-id'));
}

{
  const cube = geometry('cube', 'body/cube', 'root', [
    property('origin', vector([0, 0, 0])), property('size', vector([1, 1, 1]))
  ], [], boxSurface);
  const result = issuesFor(baseIr([instance('body', [cube])]), [planFor('box', 4, 2)]);
  assert.ok(result.product);
  if (result.product) {
    assert.equal(Object.isFrozen(result.product), true);
    assert.equal(Object.isFrozen(result.product.nodes), true);
    assert.equal(Object.isFrozen(result.product.nodes[0]), true);
    assert.equal(Object.isFrozen(result.product.nodes[0]?.transform), true);
    const cubeNode = result.product.nodes.find((node) => node.kind === 'cube');
    assert.ok(cubeNode && cubeNode.kind === 'cube');
    if (cubeNode?.kind === 'cube') assert.equal(Object.isFrozen(cubeNode.faces), true);
  }
}
