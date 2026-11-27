'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
import { inflateSync } from 'node:zlib';

const root = path.resolve(__dirname, '../../../..'),
  cli = path.join(__dirname, '../../dist/ashfox.cjs');
const fox = path.join(root, 'showcase/assets/models/red_fox.ashfox'),
  sword = path.join(root, 'showcase/assets/sprites/iron_sword.ashfox'),
  marker = path.join(root, 'showcase/assets/models/rune_bricks.ashfox'),
  sound = path.join(root, 'showcase/assets/sounds/claw_hit.ashfox'),
  cottage = path.join(root, 'showcase/assets/structures/tavern.ashfox');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-capture-test-'));

const run = (args: string[], options = {}) =>
  spawnSync(process.execPath, [cli, ...args], {
    cwd: temp,
    timeout: 150000,
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });

const success = (result: ReturnType<typeof run>) => {
  assert.equal(result.status, 0, result.stderr.toString());
  assert.equal(result.stderr.length, 0);
  return result.stdout;
};

const png = (bytes: Buffer, width: number, height: number) => {
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  assert.equal(bytes.readUInt32BE(16), width);
  assert.equal(bytes.readUInt32BE(20), height);
};

const withPreview = (
  entryPath: string,
  previewBody: string,
  extraFiles: Record<string, string>,
  name = path.basename(entryPath),
) => {
  const source = fs
    .readFileSync(entryPath, 'utf8')
    .replace(/(\}\s*)$/, `  preview v {\n${previewBody}\n  }\n$1`);
  return JSON.stringify({ source, name, files: extraFiles });
};

const stageIdCounter = { n: 0 };
const renderStagedPreview = (
  entryPath: string,
  previewBody: string,
  replacements: Record<string, string>,
  extraFiles: Record<string, string>,
  relEntry = path.basename(entryPath),
) => {
  stageIdCounter.n += 1;
  const stageDir = path.join(temp, `stage-${stageIdCounter.n}`);
  fs.mkdirSync(stageDir, { recursive: true });
  for (const [rel, content] of Object.entries(extraFiles)) {
    const dest = path.join(stageDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
  }
  let source = fs.readFileSync(entryPath, 'utf8');
  for (const [from, to] of Object.entries(replacements)) {
    source = source.replaceAll(from, to);
  }
  source = source.replace(/(\}\s*)$/, `  preview v {\n${previewBody}\n  }\n$1`);
  const stagedEntry = path.join(stageDir, relEntry);
  fs.mkdirSync(path.dirname(stagedEntry), { recursive: true });
  fs.writeFileSync(stagedEntry, source);
  try {
    return success(run(['render', stagedEntry, '--view', 'v']));
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
};

const foxMods = {
  'fox_fur.ashfox': fs.readFileSync(
    path.join(root, 'showcase/assets/module/fox/fox_fur.ashfox'),
    'utf8',
  ),
};
const foxReplacements = { '"fox_fur/fur"': '"./fox_fur.ashfox"' };
const cottageMods = {
  'wall_lantern.ashfox': fs.readFileSync(
    path.join(root, 'showcase/assets/models/wall_lantern.ashfox'),
    'utf8',
  ),
};
const cottageReplacements = { '"../models/wall_lantern.ashfox"': '"./wall_lantern.ashfox"' };
const inlineBoxSource = `ashfox 1
model box_demo {
  rig contract Rig { joint root { parent = none; role = root; channels = rotation; } }
  skeleton Skel implements Rig { bind root { parent_origin = (0u, 0u, 0u); } }
  surface contract Surf { chart body box { coverage = opaque; } material = opaque; }
  surface coat: Surf {
    material = opaque;
    texture atlas {
      density = 2;
      background = bg; background_alpha = 255;
      palette { bg = #101014; tone = (#7a5230, #9a6e44, #bc8e60); }
      chart body box { fill = tone; }
    }
  }
  component Box {
    requires rig skeleton: Rig;
    requires surface skin: Surf;
    bind bone root to skeleton.root;
    geometry { bone root { cube body { origin = (-4u, 0u, -4u); size = (8u, 8u, 8u); surface = skin.body; } } }
  }
  motion idle for Rig {
    duration = 10s; fps = 30; loop = loop; rest_relative = true;
    track root.rotation { key 0s = (0deg, 0deg, 0deg) smooth; key 5s = (0deg, 180deg, 0deg) linear; key 10s = (0deg, 360deg, 0deg) linear; }
  }
  settings { density = 16; forward = north; profile = prop; }
  skeleton = Skel;
  motions = [idle];
  use Box as model { skeleton = Rig; skin = coat; }
}
`;
const swordInline = `ashfox 1
sprite iron_sword {
  import "../module/shared.ashfox" as shared;
  profile = item;
  canvas = (32px, 32px);
  palette { glint = #ffffff; }
  polygon blade_body {
    points = [(11px, 16px), (15px, 20px), (26px, 9px), (28px, 3px), (22px, 5px)];
    material = shared.steel;
    shade { form = bevel; light = top_left; contrast = 2; specular = 2; axis = [(13px, 18px), (28px, 3px)]; }
  }
  capsule grip {
    from = (5px, 26px); to = (12px, 19px); radius = 1.4px;
    material = shared.leather;
    shade { form = cylinder; light = top_left; contrast = 2; }
  }
  outline edge { mode = sel_out; strength = 2; inner_rim = true; }
}
`;
const swordMods = {
  'module/shared.ashfox': `ashfox 1
module shared {
  export material steel { ramp { mode = auto; base = #b2becb; preset = metal; } }
  export material leather { ramp { mode = auto; base = #7b4e30; preset = warm; } }
}
`,
};

const renderPreview = (
  entryPath: string,
  body: string,
  files: Record<string, string>,
  name = path.basename(entryPath),
  replacements: Record<string, string> = {},
) => renderStagedPreview(entryPath, body, replacements, files, name);

const verifyStructureCutaway = () => {
  const name = 'tavern.ashfox';
  const full = renderPreview(
    cottage,
    'width = 160; height = 128;',
    cottageMods,
    name,
    cottageReplacements,
  );
  png(full, 160, 128);
  const cut = renderPreview(
    cottage,
    'cutaway = 4; width = 160; height = 128;',
    cottageMods,
    name,
    cottageReplacements,
  );
  png(cut, 160, 128);
  assert.notDeepEqual(full, cut);

  const ext = renderPreview(
    cottage,
    'sheet = exterior; width = 240; height = 180;',
    cottageMods,
    name,
    cottageReplacements,
  );
  png(ext, 240, 180);
  const cutSheet = renderPreview(
    cottage,
    'sheet = cutaway; width = 240; height = 180;',
    cottageMods,
    name,
    cottageReplacements,
  );
  png(cutSheet, 240, 180);
  const interior = renderPreview(
    cottage,
    'sheet = interior; width = 240; height = 180;',
    cottageMods,
    name,
    cottageReplacements,
  );
  png(interior, 240, 180);
  assert.notDeepEqual(ext, cutSheet);
  assert.notDeepEqual(ext, interior);

  const gif = renderPreview(
    cottage,
    'kind = gif; mode = turntable; width = 128; height = 96; duration = 0.25; fps = 4;',
    cottageMods,
    name,
    cottageReplacements,
  );
  assert.equal(gif.subarray(0, 6).toString(), 'GIF89a');
};

async function main() {
  const left = renderPreview(
    fox,
    'camera = left; width = 160; height = 128;',
    foxMods,
    'red_fox.ashfox',
    foxReplacements,
  );
  png(left, 160, 128);

  const boxInputJson = (body: string) =>
    JSON.stringify({
      source: inlineBoxSource.replace(/(\}\s*)$/, `  preview v {\n${body}\n  }\n$1`),
      name: 'box_demo.ashfox',
      files: {},
    });
  const jsonLeft = success(
    run(['render', '--input-json', '--view', 'v'], {
      input: boxInputJson('camera = left; width = 160; height = 128;'),
    }),
  );
  const isolated = path.join(temp, 'ashfox.cjs');
  fs.copyFileSync(cli, isolated);
  const cold = success(
    spawnSync(process.execPath, [isolated, 'render', '--input-json', '--view', 'v'], {
      cwd: temp,
      input: boxInputJson('camera = left; width = 160; height = 128;'),
      timeout: 120000,
      maxBuffer: 64 * 1024 * 1024,
    }),
  );
  assert.deepEqual(
    cold,
    jsonLeft,
    'The self-contained binary reproduces pixels in the same renderer profile',
  );
  fs.unlinkSync(isolated);

  const right = renderPreview(
    fox,
    'camera = right; width = 160; height = 128;',
    foxMods,
    'red_fox.ashfox',
    foxReplacements,
  );
  assert.notDeepEqual(left, right);

  const orbit = renderPreview(
    fox,
    'azimuth = 45; elevation = 20; background = transparent;',
    foxMods,
    'red_fox.ashfox',
    foxReplacements,
  );
  png(orbit, 640, 360);
  const idat = [];
  for (let offset = 8; offset < orbit.length;) {
    const length = orbit.readUInt32BE(offset);
    if (orbit.toString('ascii', offset + 4, offset + 8) === 'IDAT')
      idat.push(orbit.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  assert.equal(orbit[25], 6);
  assert.equal(inflateSync(Buffer.concat(idat))[4], 0, 'Transparent corner retains alpha');

  const spritePayload = (body: string) =>
    JSON.stringify({
      source: swordInline.replace(/(\}\s*)$/, `  preview v {\n${body}\n  }\n$1`),
      name: 'sprites/iron_sword.ashfox',
      files: swordMods,
    });
  const sprite = success(
    run(['render', '--input-json', '--view', 'v'], {
      input: spritePayload('scale = 16; background = checker;'),
    }),
  );
  png(sprite, 512, 512);
  const stage = success(
    run(['render', '--input-json', '--view', 'v'], {
      input: spritePayload('stage = silhouette; scale = 16; background = checker;'),
    }),
  );
  assert.notDeepEqual(sprite, stage);

  for (const retired of [
    ['render', fox, '--camera', 'left'],
    ['render', fox, '--gif'],
    ['render', sword, '--scale', '12'],
    ['render', cottage, '--cutaway', '4'],
    ['render', '--stdin', '--input-format', 'png'],
    ['render', 'fake.png'],
  ]) {
    assert.equal(run(retired).status, 2, `${retired.join(' ')} must exit 2`);
  }
  assert.equal(run(['render', sword, '--view', 'nonexistent']).status, 2);

  const gif = renderPreview(
    fox,
    'kind = gif; clip = "tail_wag"; duration = 0.5; fps = 4; width = 160; height = 128;',
    foxMods,
    'red_fox.ashfox',
    foxReplacements,
  );
  assert.equal(gif.subarray(0, 6).toString(), 'GIF89a');

  const build = renderPreview(marker, 'kind = gif; mode = build;', {});
  assert.equal(build.subarray(0, 6).toString(), 'GIF89a');

  const badClip = run(['render', '--input-json', '--view', 'v'], {
    input: boxInputJson('clip = "nonexistent";'),
  });
  assert.notEqual(badClip.status, 0);
  assert.equal(badClip.stdout.length, 0);

  const noBrowser = run(['render', fox], {
    env: { ...process.env, ASHFOX_CHROME_PATH: '/not/a/browser' },
  });
  assert.notEqual(noBrowser.status, 0);
  assert.equal(noBrowser.stdout.length, 0);

  const wave = renderPreview(sound, 'width = 320; height = 128;', {});
  png(wave, 320, 128);

  const longRender = spawn(process.execPath, [cli, 'render', '--input-json', '--view', 'v'], {
    cwd: temp,
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  longRender.stdin.end(boxInputJson('kind = gif; clip = "idle"; duration = 10; fps = 30;'));
  await new Promise((resolve) => setTimeout(resolve, 150));
  longRender.kill('SIGINT');
  const cancelCode = await new Promise<number | null>((resolve) =>
    longRender.once('exit', (code) => resolve(code)),
  );
  assert.notEqual(cancelCode, 0);

  const sheetTurnaround = renderPreview(
    fox,
    'sheet = turnaround; width = 320; height = 320;',
    foxMods,
    'red_fox.ashfox',
    foxReplacements,
  );
  png(sheetTurnaround, 320, 320);
  const sheetInspect = renderPreview(
    fox,
    'sheet = inspect; width = 320; height = 320;',
    foxMods,
    'red_fox.ashfox',
    foxReplacements,
  );
  png(sheetInspect, 320, 320);
  assert.notDeepEqual(sheetTurnaround, sheetInspect);

  const directShowcaseFox = success(run(['render', fox]));
  png(directShowcaseFox, 640, 360);

  verifyStructureCutaway();
  assert.deepEqual(fs.readdirSync(temp), [], 'No implicit asset files or workspace');
  fs.writeFileSync('/tmp/ashfox-observer-fox.png', orbit);
  fs.writeFileSync('/tmp/ashfox-observer-sword.png', sprite);
  fs.writeFileSync('/tmp/ashfox-observer-motion.gif', gif);
  fs.writeFileSync('/tmp/ashfox-observer-wave.png', wave);
  console.log(
    'Real headless renders: preview --view (still/gif/sheet/stage/cutaway/waveform), retired flags and cancellation passed',
  );
}
main()
  .finally(() => fs.rmSync(temp, { recursive: true, force: true }))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
