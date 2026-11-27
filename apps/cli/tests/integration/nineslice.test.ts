'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-9slice-'));
const configPath = path.join(temp, '.ashfoxworkspace');

const config = {
  format: 'ashfox-workspace',
  version: 2,
  name: 'nine-slice-test',
  packages: [
    {
      name: 'ui_pack',
      root: 'assets/sprites',
      manifest: {
        format: 'ashfox-package',
        version: 1,
        entries: [
          { name: 'ui_panel', path: 'ui_panel.ashfox' },
          { name: 'plain_item', path: 'plain_item.ashfox' },
        ],
        modules: [],
        dependencies: [],
      },
    },
  ],
  include: ['assets/**/*.ashfox'],
  ignore: [],
  build: { directory: 'dist/build' },
  exports: [
    {
      name: 'ui_panel',
      entry: { packageName: 'ui_pack', entryName: 'ui_panel' },
      format: 'png',
      directory: 'dist/ui_panel',
    },
    {
      name: 'plain_item',
      entry: { packageName: 'ui_pack', entryName: 'plain_item' },
      format: 'png',
      directory: 'dist/plain_item',
    },
  ],
};

try {
  fs.mkdirSync(path.join(temp, 'assets/sprites'), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config));
  fs.writeFileSync(
    path.join(temp, 'assets/sprites/ui_panel.ashfox'),
    `ashfox 1
sprite ui_panel {
  import "std/sprite/ui/panel" as ui;
  profile = ui_9slice;
  canvas = (32px, 32px);
  slice = (6px, 6px, 6px, 6px);
  palette { corner = #7aefff; }
  rect outer { x = 1px; y = 1px; width = 30px; height = 30px; material = ui.scifi_bezel; shade { form = bevel; light = top_left; contrast = 2; axis = [(1px, 1px), (30px, 30px)]; } }
  rect inner { x = 4px; y = 4px; width = 24px; height = 24px; material = ui.scifi_slate; shade { form = flat; light = top_left; contrast = 0; } }
  rect trim { x = 3px; y = 3px; width = 26px; height = 2px; material = ui.hud_cyan; shade { form = flat; light = top_left; contrast = 0; } }
  paint rivet { at = (2px, 2px); rows = ["cc", "cc"]; colors { c = corner; } }
  outline edge { mode = sel_out; strength = 2; inner_rim = true; }
}
`,
  );
  fs.writeFileSync(
    path.join(temp, 'assets/sprites/plain_item.ashfox'),
    `ashfox 1
sprite plain_item {
  import "std/sprite/item/potion" as pot;
  profile = item;
  canvas = (32px, 32px);
  palette { glint = #ffffff; }
  ellipse body { cx = 15px; cy = 18px; rx = 9px; ry = 8px; material = pot.bottle_glass; shade { form = round; light = top_left; contrast = 2; specular = 2; } }
  ellipse elixir { cx = 15px; cy = 20px; rx = 7px; ry = 5px; material = pot.health_ruby; shade { form = round; light = top_left; contrast = 2; specular = 1; } grain soft { amount = 1; seed = 5; } }
  rect neck { x = 13px; y = 7px; width = 6px; height = 5px; material = pot.bottle_glass; shade { form = cylinder; light = top_left; contrast = 2; axis = [(16px, 7px), (16px, 12px)]; } }
  rect stopper { x = 13px; y = 4px; width = 6px; height = 3px; material = pot.cork_wood; shade { form = bevel; light = top_left; contrast = 2; axis = [(13px, 6px), (18px, 4px)]; } }
  paint spec { at = (11px, 14px); rows = ["gg", "g."]; colors { g = glint; } }
  outline edge { mode = sel_out; strength = 2; inner_rim = true; }
}
`,
  );

  const child = spawnSync(
    process.execPath,
    [path.join(__dirname, '../../dist/ashfox.cjs'), 'build', configPath, '--json'],
    { encoding: 'utf8', timeout: 120000 },
  );
  assert.equal(child.status, 0, child.stderr + child.stdout);
  const reply = JSON.parse(String(child.stdout));
  assert.equal(reply.ok, true, JSON.stringify(reply));

  const exportDir = (id: string): string => {
    const found = reply.result.exports.find((e: { id: string }) => e.id === id);
    assert.ok(found, `Missing export ${id}`);
    return found.directory;
  };

  const panelDir = exportDir('ui_panel');
  const panelMetaPath = path.join(panelDir, 'ui_panel.sprite.json');
  assert.equal(fs.existsSync(panelMetaPath), true, `Expected ${panelMetaPath}`);
  assert.deepEqual(JSON.parse(fs.readFileSync(panelMetaPath, 'utf8')), {
    nineSlice: { left: 6, right: 6, top: 6, bottom: 6 },
  });

  const itemDir = exportDir('plain_item');
  const itemMetaPath = path.join(itemDir, 'plain_item.sprite.json');
  assert.equal(fs.existsSync(itemMetaPath), false, 'Non-ui_9slice must not emit .sprite.json');
  console.log('ui_9slice .sprite.json delivery and byte-identical non-9slice omission ok');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
