'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import * as THREE from 'three';
import { createAshfoxLod, updateAshfoxLodWithHysteresis } from '@ashfox/render-core';

const root = path.resolve(__dirname, '../../../..'),
  cli = path.join(__dirname, '../../dist/ashfox.cjs');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-observe-test-'));
const source = `ashfox 1
sprite apple {
  import "../module/shared.ashfox" as shared;
  profile = item;
  canvas = (32px, 32px);
  palette { bark = #734b34; glint = #fff5e6; }
  ellipse body {
    cx = 16px; cy = 18px; rx = 9px; ry = 8px;
    material = shared.red_skin;
    shade { form = round; light = top_left; contrast = 2; specular = 1; }
    grain soft { amount = 1; seed = 23; }
  }
  stamp stem_top { stamp = shared.stem; at = (15px, 7px); flip = none; colors { s = bark; } }
  paint shine { at = (11px, 13px); rows = ["gg", "g."]; colors { g = glint; } }
  outline rim { mode = sel_out; strength = 2; inner_rim = true; }
}
`;
const shared = `ashfox 1
module shared {
  export material red_skin { ramp { mode = auto; base = #c94040; preset = organic; } }
  export stamp stem { rows = ["ss", ".s"]; slots = ["s"]; }
}
`;
const input = {
  source,
  name: 'sprites/apple.ashfox',
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
  assert.equal(checkedSprite.receipt.width, 32);
  assert.equal(checkedSprite.evidence.length, 1024);
  assert.equal(checkedSprite.audit.passed, true);
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
    .readFileSync(path.join(root, 'showcase/assets/models/rune_bricks.ashfox'), 'utf8')
    .replace(
      '  settings {',
      '  outputs {\n    glb;\n    java_block namespace = "demo" path = "props/marker";\n  }\n  settings {',
    );
  const markerPath = path.join(standaloneDir, 'rune_bricks.ashfox');
  fs.writeFileSync(markerPath, markerSrc);
  const badAncestor = run(['check', markerPath]);
  assert.notEqual(badAncestor.status, 0);
  const isolatedBlockSrc = `ashfox 1
model isolated_block {
  rig contract BlockRig { joint root { parent = none; role = root; channels = rotation; } }
  skeleton BlockSkeleton implements BlockRig { bind root { parent_origin = (0u, 0u, 0u); } }
  surface contract BlockSkin { chart block box { coverage = opaque; } material = opaque; }
  surface stone: BlockSkin {
    material = opaque;
    texture atlas {
      density = 1;
      background = bg; background_alpha = 255;
      palette { bg = #181a1f; base = (#555963, #777c88, #999faa); }
      chart block box { fill = base; roughness = 0.85; grain = soft; }
    }
  }
  component BlockBody {
    requires rig skeleton: BlockRig;
    requires surface skin: BlockSkin;
    bind bone root to skeleton.root;
    geometry { bone root { cube main { origin = (-8u, 0u, -8u); size = (16u, 16u, 16u); surface = skin.block; } } }
  }
  settings { density = 16; forward = north; profile = block; }
  skeleton = BlockSkeleton;
  use BlockBody as block_mesh { skeleton = BlockRig; skin = stone; }
}`;
  const isolatedMarkerCheck = JSON.parse(
    String(success(run(['check', '--stdin', '--name', 'isolated_block.ashfox'], isolatedBlockSrc))),
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
  const glb = fs.readFileSync(path.join(glbDir, 'rune_bricks_glb.glb'));
  assert.equal(glb.subarray(0, 4).toString(), 'glTF');
  const jbModel = JSON.parse(
    fs.readFileSync(path.join(jbDir, 'assets/demo/models/block/props/marker.json'), 'utf8'),
  );
  assert.ok(fs.existsSync(path.join(jbDir, 'pack.mcmeta')));
  assert.ok(jbModel.elements.length > 0);

  const sceneRoot = new THREE.Group();
  const skeletonRoot = new THREE.Bone();
  skeletonRoot.name = 'body';
  const tier0 = new THREE.Group();
  tier0.name = 'griffin_LOD0';
  const tier1 = new THREE.Group();
  tier1.name = 'griffin_LOD1';
  const tier2 = new THREE.Group();
  tier2.name = 'griffin_LOD2';
  sceneRoot.add(skeletonRoot, tier0, tier1, tier2);
  const lod = createAshfoxLod(sceneRoot, { distances: [0, 18, 45] });
  assert.equal(lod.children.includes(skeletonRoot), true);
  assert.equal(lod.levels.length, 3);
  updateAshfoxLodWithHysteresis(lod, new THREE.Vector3(0, 0, 30));
  assert.equal(tier0.visible, false);
  assert.equal(tier1.visible, true);
  assert.equal(skeletonRoot.visible, true);
  console.log('5-verb check/build/render hardcut, declared multi-outputs, and retired flags pass');
}
main()
  .finally(() => fs.rmSync(temp, { recursive: true, force: true }))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
