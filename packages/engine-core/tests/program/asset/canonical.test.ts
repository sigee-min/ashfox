import assert from 'node:assert/strict';

import { canonicalRotatePoint } from '../../../src/model/transform';
import { boneTransformMatchesCanonicalFrame } from '../../../src/model/scene';
import { sourceSpan } from '../../../src/project/source/lexer';
import {
  assetBooleanValue,
  assetExactNumber,
  assetNumberValue,
  assetVectorValue,
  type AssetNumberValue
} from '../../../src/compiler/program/asset/value/contract';
import type {
  AssetExactFrame,
  AssetSignedAxis,
  AssetSymbolId,
  AssetSymbolKind,
  AssetUnitVectorValue
} from '../../../src/compiler/program/asset/contract';
import { lowerAssetRigAndMotions } from
  '../../../src/compiler/program/asset/canonicalRig';
import type {
  InstantiatedAssetIr,
  InstantiatedBone,
  InstantiatedMotion,
  InstantiatedMotionChannel,
  InstantiatedMotionKey
} from '../../../src/compiler/program/asset/ir';

const span = sourceSpan('dragon.ashfox', 0, 1);
const axis = (x: -1 | 0 | 1, y: -1 | 0 | 1, z: -1 | 0 | 1): AssetSignedAxis =>
  Object.freeze([x, y, z]);
const frame = (
  origin: readonly [bigint, bigint, bigint],
  xAxis: AssetSignedAxis = axis(1, 0, 0),
  yAxis: AssetSignedAxis = axis(0, 1, 0),
  zAxis: AssetSignedAxis = axis(0, 0, 1),
  determinant: -1 | 1 = 1
): AssetExactFrame => Object.freeze({
  origin: Object.freeze(origin.map((value) => assetExactNumber(value, 1n, 'unit'))),
  xAxis, yAxis, zAxis, determinant
}) as AssetExactFrame;
const number = (value: bigint, unit: 'plain' | 'second' | 'degree' | 'ratio'): AssetNumberValue =>
  assetNumberValue(assetExactNumber(value, 1n, unit));
const vector = (
  values: readonly [bigint, bigint, bigint],
  type: 'vec3<degree>' | 'vec3<ratio>'
) => assetVectorValue(values.map((value) => number(value,
  type === 'vec3<degree>' ? 'degree' : 'ratio')), type);
const symbol = (kind: AssetSymbolKind, name: string, key: string): AssetSymbolId =>
  Object.freeze({ modulePath: key.split('\u0000')[0]!, name, kind, key });

const bone = (
  id: string,
  parentId: string | null,
  parentRestFrame: AssetExactFrame = frame([0n, 0n, 0n])
): InstantiatedBone => Object.freeze({
  id, semanticJoint: id, parentId, parentRestFrame,
  sourcePath: 'dragon/skeleton.ashfox', span
});

const key = (
  time: bigint,
  value: AssetUnitVectorValue | ReturnType<typeof vector>,
  interpolation: 'linear' | 'step' | 'catmullrom' = 'linear'
): InstantiatedMotionKey => Object.freeze({
  time: number(time, 'second'), value, interpolation, span
});

const channel = (
  targetBoneId: string,
  property: 'rotation' | 'scale',
  keys: readonly InstantiatedMotionKey[]
): InstantiatedMotionChannel => Object.freeze({
  id: 'source-channel-id', targetBoneId, property, keys, span
});

const motion = (
  keyName: string,
  channels: readonly InstantiatedMotionChannel[]
): InstantiatedMotion => Object.freeze({
  symbol: symbol('motion', 'idle', keyName),
  sourcePath: 'dragon/motion.ashfox',
  duration: number(1n, 'second'), fps: number(24n, 'plain'),
  loop: 'loop', restRelative: assetBooleanValue(true), channels, span
});

const baseIr = (motions: readonly InstantiatedMotion[] = []): InstantiatedAssetIr => {
  const budget = Object.freeze({
    limits: Object.freeze({ instances: 1024, bones: 4096, nodes: 16384,
      faces: 65536, motionKeys: 65536, diagnostics: 256 }),
    used: Object.freeze({ instances: 0, bones: 0, nodes: 0, faces: 0,
      motionKeys: 0, diagnostics: 0 })
  });
  const root = bone('root', null);
  const child = bone('child', 'root', frame([0n, 2n, 0n], axis(-1, 0, 0),
    axis(0, 1, 0), axis(0, 0, 1), -1));
  return Object.freeze({
    asset: symbol('asset', 'dragon', 'dragon\u0000asset\u0000dragon'),
    settings: Object.freeze({ density: number(16n, 'plain'), forward: 'north' }),
    rig: symbol('rig-contract', 'DragonRig', 'dragon\u0000rig\u0000DragonRig'),
    skeleton: symbol('skeleton', 'Adult', 'dragon\u0000skeleton\u0000Adult'),
    bones: Object.freeze([child, root]), instances: Object.freeze([]),
    surfaces: Object.freeze([]), connections: Object.freeze([]),
    motions: Object.freeze(motions), budget
  });
};

const validMotionA = motion('pkg-a\u0000motion\u0000idle', [
  channel('child', 'scale', [key(0n, vector([1n, 1n, 1n], 'vec3<ratio>')),
    key(1n, vector([2n, 1n, 1n], 'vec3<ratio>'))]),
  channel('root', 'rotation', [key(0n, vector([0n, 0n, 0n], 'vec3<degree>')),
    key(1n, vector([10n, 0n, 0n], 'vec3<degree>'))])
]);
const validMotionB = motion('pkg-b\u0000motion\u0000idle', [
  channel('root', 'rotation', [key(0n, vector([0n, 0n, 0n], 'vec3<degree>'))])
]);

const valid = lowerAssetRigAndMotions(baseIr([validMotionB, validMotionA]));
assert.equal(valid.ok, true, valid.ok ? '' : valid.diagnostics.map((item) => item.code).join(', '));
if (valid.ok) {
  assert.deepEqual(valid.roots, ['root']);
  assert.deepEqual(valid.bones.map((item) => item.id), ['child', 'root']);
  const child = valid.bones.find((item) => item.id === 'child')!;
  assert.equal(child.parentId, 'root');
  assert.deepEqual(child.transform.scale, [-1, 1, 1]);
  assert.equal(boneTransformMatchesCanonicalFrame(child), true);
  assert.equal(Object.keys(valid.animations).length, 2);
  const clips = Object.values(valid.animations);
  assert.notEqual(clips[0]!.id, clips[1]!.id);
  const rotation = clips.flatMap((clip) => Object.values(clip.channels))
    .find((item) => item.property === 'rotation' && item.keys.length === 2)!;
  assert.equal(rotation.rotationSpace, 'bone');
  assert.deepEqual(rotation.keys[1]!.value, [10, 0, 0]);
  const scale = clips.flatMap((clip) => Object.values(clip.channels))
    .find((item) => item.property === 'scale')!;
  assert.deepEqual(scale.keys[1]!.value, [2, 1, 1]);
  assert.equal(Object.isFrozen(valid), true);
  assert.equal(Object.isFrozen(valid.bones), true);
  assert.equal(Object.isFrozen(child.transform), true);
  assert.equal(Object.isFrozen(child.transform.pivot), true);
  assert.equal(Object.isFrozen(child.canonicalFrame), true);
  assert.equal(Object.isFrozen(clips[0]!.channels), true);
  assert.equal(Object.isFrozen(rotation.keys), true);
  assert.equal(Object.isFrozen(rotation.keys[0]!.value), true);
}

const reversed = lowerAssetRigAndMotions({
  ...baseIr([validMotionA, validMotionB]),
  bones: [...baseIr().bones].reverse()
});
assert.deepEqual(reversed, valid);

const duplicateClip = lowerAssetRigAndMotions(baseIr([validMotionA, validMotionA]));
assert.equal(duplicateClip.ok, false);
if (!duplicateClip.ok) assert.ok(duplicateClip.diagnostics.some((item) =>
  item.code === 'asset.duplicate-clip-id'));

const cycle = lowerAssetRigAndMotions({
  ...baseIr(), bones: [bone('root', 'child'), bone('child', 'root')]
});
assert.equal(cycle.ok, false);
if (!cycle.ok) assert.ok(cycle.diagnostics.some((item) => item.code === 'asset.bone-cycle'));

const unsafeTime = number(1n << 60n, 'second');
const unsafeMotion = Object.freeze({
  ...validMotionB,
  channels: Object.freeze([channel('root', 'rotation', [Object.freeze({
    ...key(0n, vector([0n, 0n, 0n], 'vec3<degree>')), time: unsafeTime
  })])])
});
const unsafe = lowerAssetRigAndMotions(baseIr([unsafeMotion]));
assert.equal(unsafe.ok, false);
if (!unsafe.ok) assert.ok(unsafe.diagnostics.some((item) => item.code === 'asset.value.unsafe-number'));

const zeroScale = lowerAssetRigAndMotions(baseIr([motion('pkg-zero\u0000motion\u0000scale', [
  channel('child', 'scale', [key(0n, vector([0n, 1n, 1n], 'vec3<ratio>'))])
])]));
assert.equal(zeroScale.ok, false);
if (!zeroScale.ok) assert.ok(zeroScale.diagnostics.some((item) => item.code === 'asset.motion-scale'));

const missingTarget = lowerAssetRigAndMotions(baseIr([motion('pkg-missing\u0000motion\u0000target', [
  channel('missing', 'rotation', [key(0n, vector([0n, 0n, 0n], 'vec3<degree>'))])
])]));
assert.equal(missingTarget.ok, false);
if (!missingTarget.ok) assert.ok(missingTarget.diagnostics.some((item) =>
  item.code === 'asset.motion-target-missing'));

console.log('canonical rig and motion lowering ok');

// Non-zero ancestors, rotation and reflection must agree with parent-frame composition.
const nested = lowerAssetRigAndMotions({ ...baseIr(), bones: [
  bone('grandchild', 'child', frame([5n, 6n, 7n])),
  bone('child', 'root', frame([2n, 3n, 4n], axis(-1, 0, 0), axis(0, 1, 0), axis(0, 0, 1), -1)),
  bone('root', null, frame([10n, 20n, 30n], axis(0, 1, 0), axis(-1, 0, 0), axis(0, 0, 1)))
] });
assert.ok(nested.ok);
if (nested.ok) {
  const nodes = new Map(nested.bones.map((node) => [node.id, node]));
  const worldOrigin = (id: string): readonly [number, number, number] => {
    const chain = [];
    let node = nodes.get(id)!;
    while (true) { chain.push(node); if (!node.parentId) break; node = nodes.get(node.parentId)!; }
    let point: readonly [number, number, number] = [0, 0, 0];
    for (const owner of chain) {
      const parent = owner.parentId ? nodes.get(owner.parentId)! : null;
      const rotated = canonicalRotatePoint([point[0] * owner.transform.scale[0], point[1] * owner.transform.scale[1], point[2] * owner.transform.scale[2]], owner.transform.rotation);
      point = [0, 1, 2].map((index) => rotated[index]! + owner.transform.pivot[index]! - (parent?.transform.pivot[index] ?? 0)) as [number, number, number];
    }
    return point;
  };
  for (const [id, expected] of [['root', [10, 20, 30]], ['child', [7, 22, 34]], ['grandchild', [1, 17, 41]]] as const) {
    const actual = worldOrigin(id);
    actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]!) < 1e-9, `${id} world origin is wrong`));
  }
}
