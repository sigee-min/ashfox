import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { openAssetProject, readWorkspaceFile, type AxisCubeNode } from '@ashfox/engine-core';
import { applyAnimationPose } from '@ashfox/render-core/animationPose';
import type { ProjectSceneProjection } from '@ashfox/render-core/sceneTypes';

const read = readWorkspaceFile(readFileSync(resolve(__dirname, '../../../../assets/workspaces/goblin.ashfoxworkspace')));
if (!read.ok) throw new Error('Goblin workspace did not open');
const opened = openAssetProject({ workspace: read.workspace, entry: { packageName: 'creatures', entryName: 'goblin' }, identity: { id: 'motion-test', revision: 'test-0001', createdAt: '2026-09-08T00:00:00.000Z' } });
if (!opened.ok) throw new Error('Goblin did not compile');
const document = opened.project.document;
const root = new THREE.Group();
const objectsByNodeId = new Map(Object.keys(document.scene.nodes).map((id) => [id, new THREE.Group()]));
for (const node of Object.values(document.scene.nodes)) {
  (node.parentId ? objectsByNodeId.get(node.parentId) : root)?.add(objectsByNodeId.get(node.id)!);
}
const projection: ProjectSceneProjection = { documentReference: document, root, objectsByNodeId, selectable: [], readiness: { status: 'ready', error: null }, ready: Promise.resolve(), dispose: () => {} };
const cube = (suffix: string): AxisCubeNode => {
  const found = Object.values(document.scene.nodes).find((node) => node.name.endsWith(suffix));
  assert.ok(found?.kind === 'cube' && found.geometryMode === 'axis-box', suffix);
  return found;
};
const point = (node: AxisCubeNode, coordinates: readonly number[]): THREE.Vector3 =>
  new THREE.Vector3(...coordinates.map((value, index) => value - node.transform.pivot[index])).applyMatrix4(objectsByNodeId.get(node.id)!.matrixWorld);
const center = (node: AxisCubeNode): THREE.Vector3 => point(node, node.bounds.from.map((value, index) => (value + node.bounds.to[index]) / 2));
const challenge = Object.values(document.animations).find((clip) => clip.name === 'challenge');
assert.ok(challenge);
const pose = (time: number): void => { applyAnimationPose(document, projection, challenge.id, time); root.updateMatrixWorld(true); };
const blade = cube('/weapon/blade');
const hand = cube('/right_arm/hand');
const grip = cube('/weapon/grip');
const shoulder = cube('/right_arm/pauldron');
const boots = [cube('/left_leg/boot'), cube('/right_leg/boot')];
const tip = (): THREE.Vector3 => point(blade, [(blade.bounds.from[0] + blade.bounds.to[0]) / 2, (blade.bounds.from[1] + blade.bounds.to[1]) / 2, blade.bounds.from[2]]);
pose(0);
const restTip = tip();
const restShoulder = center(shoulder);
const restFeet = boots.map(center);
pose(1.1);
assert.ok(tip().y > restTip.y + 5, 'challenge must lift the blade, rather than dip it toward the floor');
assert.ok(tip().x > restTip.x + 2, 'the raised blade must clear the face on the outside');
for (let frame = 0; frame <= 72; frame += 1) {
  pose(frame / 24);
  assert.ok(point(hand, [6.5, 10, -1]).distanceTo(point(grip, [6.5, 10, -1])) < 1e-7, 'weapon contact must stay in the hand');
  assert.ok(center(shoulder).distanceTo(restShoulder) < 1e-7, 'shoulder armor must turn at the shoulder, not orbit a point above it');
  boots.forEach((boot, index) => assert.ok(center(boot).distanceTo(restFeet[index]) < 1e-7, 'feet must stay planted'));
}
assert.ok(tip().distanceTo(restTip) < 1e-7, 'challenge must return to its loop pose');
console.log('goblin challenge: raised blade, fixed shoulders, grip contact, planted feet and loop continuity verified');
