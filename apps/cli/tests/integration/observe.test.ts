'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const root = path.resolve(__dirname, '../../../..'),
  cli = path.join(__dirname, '../../dist/ashfox.cjs');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-observe-test-'));
const source = fs.readFileSync(
  path.join(root, 'examples/items/assets/sprites/iron_sword.ashfox'),
  'utf8',
);
const shared = fs.readFileSync(
  path.join(root, 'examples/items/assets/module/shared.ashfox'),
  'utf8',
);
const input = {
  source,
  name: 'sprites/iron_sword.ashfox',
  files: { 'module/shared.ashfox': shared },
};
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
  assert.deepEqual(checkedSprite.declarations.outputs, [{ format: 'png' }]);

  const retiredExport = run(['export', '--input-json'], JSON.stringify(input));
  assert.equal(retiredExport.status, 2);
  const retiredPngInput = run(['check', 'fake.png']);
  assert.equal(retiredPngInput.status, 2);
  const retiredInputFormat = run(['check', '--stdin', '--input-format', 'png'], 'abc');
  assert.equal(retiredInputFormat.status, 2);

  const bad = run(['render', '--stdin'], 'invalid');
  assert.notEqual(bad.status, 0);
  assert.equal(bad.stdout.length, 0);
  assert.match(bad.stderr.toString(), /error/);

  const ignored = path.join(temp, '.ashfoxworkspace');
  fs.writeFileSync(ignored, 'invalid workspace deliberately ignored');
  const standaloneDir = path.join(temp, 'standalone');
  fs.mkdirSync(standaloneDir);
  const markerSrc = fs
    .readFileSync(path.join(root, 'examples/minecraft/assets/models/marker.ashfox'), 'utf8')
    .replace(
      'export asset marker {',
      '  outputs {\n    glb;\n    java_block namespace = "demo" path = "props/marker";\n  }\n  export asset marker {',
    );
  const markerPath = path.join(standaloneDir, 'marker.ashfox');
  fs.writeFileSync(markerPath, markerSrc);
  const badAncestor = run(['check', markerPath]);
  assert.notEqual(badAncestor.status, 0);
  const isolatedMarkerCheck = JSON.parse(
    String(success(run(['check', '--stdin', '--name', 'marker.ashfox'], markerSrc))),
  ).result;
  assert.equal(isolatedMarkerCheck.kind, 'model');

  fs.unlinkSync(ignored);
  const markerCheck = JSON.parse(String(success(run(['check', markerPath])))).result;
  assert.equal(markerCheck.kind, 'model');
  assert.equal(markerCheck.audit.profile, 'block');
  assert.equal(markerCheck.declarations.outputs.length, 2);

  const retiredNode = run(['check', markerPath, '--node', 'root']);
  assert.equal(retiredNode.status, 2);

  const built = JSON.parse(String(success(run(['build', markerPath, '--json'])))).result;
  assert.equal(built.exports.length, 2);
  const glbDir = built.exports.find((e: { id: string }) => e.id.endsWith('_glb')).directory;
  const jbDir = built.exports.find((e: { id: string }) => e.id.endsWith('_java_block')).directory;
  const glb = fs.readFileSync(path.join(glbDir, 'marker_glb.glb'));
  assert.equal(glb.subarray(0, 4).toString(), 'glTF');
  const jbModel = JSON.parse(
    fs.readFileSync(path.join(jbDir, 'assets/demo/models/block/props/marker.json'), 'utf8'),
  );
  assert.ok(fs.existsSync(path.join(jbDir, 'pack.mcmeta')));
  assert.ok(jbModel.elements.length > 0);
  console.log('5-verb check/build/render hardcut, declared multi-outputs, and retired flags pass');
}
main()
  .finally(() => fs.rmSync(temp, { recursive: true, force: true }))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
