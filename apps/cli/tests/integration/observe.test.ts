'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { unzipSync } from 'fflate';
const root = path.resolve(__dirname, '../../../..'),
  cli = path.join(__dirname, '../../dist/ashfox.cjs');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-observe-test-'));
const source = fs.readFileSync(path.join(root, 'examples/items/src/iron_sword.ashfox'), 'utf8');
const shared = fs.readFileSync(path.join(root, 'examples/items/src/shared.ashfox'), 'utf8');
const input = { source, name: 'iron_sword.ashfox', files: { 'shared.ashfox': shared } };
const run = (args: string[], stdin?: string | Buffer | undefined) =>
  spawnSync(process.execPath, [cli, ...args], {
    cwd: temp,
    input: stdin,
    timeout: 120000,
    maxBuffer: 64 * 1024 * 1024,
  });
const success = (reply: ReturnType<typeof run>) => {
  assert.equal(reply.status, 0, String(reply.stderr) + String(reply.stdout));
  return reply.stdout;
};
async function main() {
  const checkedSprite = JSON.parse(
    String(success(run(['check', '--input-json'], JSON.stringify(input)))),
  ).result;
  assert.equal(checkedSprite.kind, 'sprite');
  assert.equal(checkedSprite.receipt.width, 16);
  assert.equal(checkedSprite.evidence.length, 256);
  const png = success(run(['export', '--input-json'], JSON.stringify(input)));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  const fromPng = JSON.parse(
    String(success(run(['check', '--stdin', '--input-format', 'png'], png))),
  ).result;
  assert.equal(fromPng.kind, 'png');
  assert.equal(fromPng.width, 16);
  const bad = run(['render', '--stdin'], 'invalid');
  assert.notEqual(bad.status, 0);
  assert.equal(bad.stdout.length, 0);
  assert.match(bad.stderr.toString(), /error/);
  const ignored = path.join(temp, '.ashfoxworkspace');
  fs.writeFileSync(ignored, 'invalid workspace deliberately ignored');
  fs.copyFileSync(
    path.join(root, 'examples/minecraft/marker.ashfox'),
    path.join(temp, 'marker.ashfox'),
  );
  const markerCheck = JSON.parse(
    String(success(run(['check', 'marker.ashfox', '--profile', 'block']))),
  ).result;
  assert.equal(markerCheck.kind, 'model');
  const nodeId = markerCheck.nodes.find((n: { kind: string }) => n.kind === 'cube').id;
  const nodeCheck = JSON.parse(
    String(success(run(['check', 'marker.ashfox', '--node', nodeId]))),
  ).result;
  assert.equal(nodeCheck.node.id, nodeId);
  const glb = success(run(['export', 'marker.ashfox']));
  assert.equal(glb.subarray(0, 4).toString(), 'glTF');
  const zip = success(
    run(['export', 'marker.ashfox', '--format', 'java_block', '--namespace', 'demo']),
  );
  const files = unzipSync(zip);
  assert.ok(Object.keys(files).some((p) => p.endsWith('marker.json')));
  assert.equal(success(run(['export', 'marker.ashfox', '--output', 'model.glb'])).length, 0);
  const original = fs.readFileSync(path.join(temp, 'model.glb'));
  const collision = run(['export', 'marker.ashfox', '--output', 'model.glb']);
  assert.notEqual(collision.status, 0);
  assert.deepEqual(fs.readFileSync(path.join(temp, 'model.glb')), original);
  assert.deepEqual(fs.readdirSync(temp).sort(), ['.ashfoxworkspace', 'marker.ashfox', 'model.glb']);
  console.log(
    'Single-asset check, source graph, PNG input, exports, no implicit writes and collision preservation passed',
  );
}
main()
  .finally(() => fs.rmSync(temp, { recursive: true, force: true }))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
