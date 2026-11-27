'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = path.resolve(__dirname, '../../../..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-exports-'));
const configPath = path.join(temp, '.ashfoxworkspace');
const count = 129;
const names = Array.from({ length: count }, (_, i) => 'item_' + String(i).padStart(3, '0'));
const config = {
  format: 'ashfox-workspace',
  version: 2,
  name: 'many-items',
  packages: [
    {
      name: 'items',
      root: 'assets/sprites',
      manifest: {
        format: 'ashfox-package',
        version: 1,
        entries: names.map((name) => ({ name, path: name + '.ashfox' })),
        modules: [],
        dependencies: [],
      },
    },
    {
      name: 'shared_modules',
      root: 'assets/module',
      manifest: {
        format: 'ashfox-package',
        version: 1,
        entries: [],
        modules: [{ subpath: './shared', path: 'shared.ashfox' }],
        dependencies: [],
      },
    },
  ],
  include: ['assets/**/*.ashfox'],
  ignore: [],
  build: { directory: 'dist/build' },
  exports: names.map((name) => ({
    name,
    entry: { packageName: 'items', entryName: name },
    format: 'png',
    directory: 'dist/' + name,
  })),
  packs: [
    {
      name: 'game',
      format: 'game_assets',
      directory: 'dist/game',
      archive: false,
      audio: 'wav',
      unitsPerMeter: 16,
      pixelsPerUnit: 16,
      spriteFilter: 'nearest',
      assets: names.map((name) => ({ id: name, source: name, path: 'items/' + name })),
    },
    {
      name: 'minecraft',
      format: 'minecraft_java',
      directory: 'dist/minecraft',
      minecraftVersion: 'configured',
      metadata: { format: 'legacy', description: 'Many items', packFormat: 46 },
      itemDefinitions: 'modern',
      archive: false,
      icon: null,
      models: [],
      sounds: [],
      items: names.map((name) => ({ source: name, id: 'demo:' + name, parent: 'generated' })),
    },
  ],
};
const write = (value: unknown) => fs.writeFileSync(configPath, JSON.stringify(value));
const run = (command: string, input = configPath) => {
  const child = spawnSync(
    process.execPath,
    [path.join(__dirname, '../../dist/ashfox.cjs'), command, input, '--json'],
    { encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 },
  );
  if (child.error) throw child.error;
  assert.equal(child.signal, null, child.stderr);
  return JSON.parse(String(child.stdout));
};
const success = (reply: ReturnType<typeof run>) => {
  assert.equal(reply.ok, true, JSON.stringify(reply));
  return reply.result;
};
try {
  fs.mkdirSync(path.join(temp, 'assets/sprites'), { recursive: true });
  fs.mkdirSync(path.join(temp, 'assets/module'), { recursive: true });
  fs.writeFileSync(
    path.join(temp, 'assets/module/shared.ashfox'),
    `ashfox 1
module shared {
  export material red_skin { ramp { mode = auto; base = #c94040; preset = organic; } }
  export stamp stem { rows = ["ss", ".s"]; slots = ["s"]; }
}
`,
  );
  const source = `ashfox 1
sprite apple {
  import "../module/shared.ashfox" as shared;
  profile = item;
  canvas = (32px, 32px);
  palette {
    bark = #734b34;
    dimple = #782026;
    glint = #fff5e6;
  }
  ellipse body {
    cx = 16px; cy = 18px; rx = 9px; ry = 8px;
    material = shared.red_skin;
    shade { form = round; light = top_left; contrast = 2; specular = 1; }
    grain soft { amount = 1; seed = 23; }
  }
  stamp stem_top { stamp = shared.stem; at = (15px, 7px); flip = none; colors { s = bark; } }
  paint crown_dimple { at = (15px, 12px); rows = ["dd"]; colors { d = dimple; } }
  paint shine { at = (11px, 13px); rows = ["gg", "g."]; colors { g = glint; } }
  outline rim { mode = sel_out; strength = 2; inner_rim = true; }
}
`;
  names.forEach((name, index) =>
    fs.writeFileSync(
      path.join(temp, 'assets/sprites', name + '.ashfox'),
      source
        .replace('sprite apple {', 'sprite ' + name + ' {')
        .replace(
          'dimple = #782026;',
          `dimple = #7820${(0x20 + index).toString(16).padStart(2, '0')};`,
        ),
    ),
  );
  write(config);
  const first = success(run('build'));
  assert.equal(first.exports.length, count + 2);
  const output = (id: string) => first.exports.find((e: { id: string }) => e.id === id).directory;
  const manifest = JSON.parse(
    String(fs.readFileSync(path.join(output('game'), 'game-assets/assets.json'))),
  );
  assert.deepEqual(manifest.assets.map((a: { id: string }) => a.id).sort(), names);
  for (const name of names) {
    const asset = manifest.assets.find((a: { id: string }) => a.id === name);
    const image = fs.readFileSync(path.join(output('game'), 'game-assets', asset.image));
    assert.equal(image.toString('hex', 0, 8), '89504e470d0a1a0a');
    const item = JSON.parse(
      String(
        fs.readFileSync(
          path.join(output('minecraft'), 'resource-pack/assets/demo/items', name + '.json'),
        ),
      ),
    );
    assert.equal(item.model.model, 'demo:item/' + name);
  }
  success(run('check', path.join(temp, 'dist/build')));
  assert.equal(success(run('build')).bundleHash, first.bundleHash);
  const readerPath = path.join(temp, 'readers.cjs');
  require('esbuild').buildSync({
    stdin: {
      contents:
        "export { readDirectoryWorkspace } from '@ashfox/engine-core'; export { readGameAssetManifest } from '@ashfox/asset-build';",
      resolveDir: root,
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: readerPath,
  });
  const { readDirectoryWorkspace, readGameAssetManifest } = require(readerPath);
  assert.deepEqual(readGameAssetManifest(manifest), manifest);
  const duplicate = structuredClone(manifest);
  duplicate.assets[count - 1].id = names[0];
  assert.throws(() => readGameAssetManifest(duplicate), /duplicate ID/);
  assert.throws(
    () => readDirectoryWorkspace(JSON.stringify({ ...config, exports: {} })),
    /array of exports/,
  );
  const invalid = structuredClone(config);
  invalid.exports[count - 1].name = names[0];
  assert.throws(() => readDirectoryWorkspace(JSON.stringify(invalid)), /unique export id/);
  const missing = structuredClone(config);
  assert.ok(missing.packs[0].assets);
  missing.packs[0].assets[count - 1].source = 'missing';
  assert.throws(
    () => readDirectoryWorkspace(JSON.stringify(missing)),
    /named GLB, PNG or WAV export/,
  );
  const badItem = structuredClone(config);
  assert.ok(badItem.packs[1].items);
  badItem.packs[1].items[count - 1].id = 'demo:' + names[0];
  assert.throws(() => readDirectoryWorkspace(JSON.stringify(badItem)), /unique item resource/);
  const pointer = path.join(temp, 'dist/build/current.json'),
    previous = fs.readFileSync(pointer);
  write(invalid);
  assert.equal(run('build').ok, false);
  assert.deepEqual(fs.readFileSync(pointer), previous);
  console.log(
    'workspace exports: 129 native entries, PNGs, Minecraft/game bindings, runtime verification, repeatability and late invalid records pass',
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
