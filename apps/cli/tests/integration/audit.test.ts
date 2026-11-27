'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(__dirname, '../../../..');
const cli = path.join(__dirname, '../../dist/ashfox.cjs');
const stageTmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-audit-')));
const foxEntry = path.join(stageTmp, 'red_fox.ashfox');
fs.writeFileSync(
  foxEntry,
  fs
    .readFileSync(path.join(root, 'showcase/assets/models/red_fox.ashfox'), 'utf8')
    .replace('"fox_fur/fur"', '"./fox_fur.ashfox"'),
);
fs.copyFileSync(
  path.join(root, 'showcase/assets/module/fox/fox_fur.ashfox'),
  path.join(stageTmp, 'fox_fur.ashfox'),
);
const lanternEntry = path.join(stageTmp, 'wall_lantern.ashfox');
fs.copyFileSync(path.join(root, 'showcase/assets/models/wall_lantern.ashfox'), lanternEntry);
const spriteEntry = path.join(stageTmp, 'iron_sword.ashfox');
fs.copyFileSync(path.join(root, 'showcase/assets/sprites/iron_sword.ashfox'), spriteEntry);
const soundEntry = path.join(stageTmp, 'claw_hit.ashfox');
fs.copyFileSync(path.join(root, 'showcase/assets/sounds/claw_hit.ashfox'), soundEntry);

const run = (args: string[], opts?: string | { cwd?: string; input?: string }) =>
  spawnSync(process.execPath, [cli, ...args], {
    cwd: typeof opts === 'string' ? opts : (opts?.cwd ?? root),
    input: typeof opts === 'object' ? opts.input : undefined,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
  });

async function main() {
  const doctor = run(['doctor', '--json']);
  assert.equal(doctor.status, 0, doctor.stderr);
  const doctorJson = JSON.parse(doctor.stdout).result;
  assert.deepEqual(doctorJson.commands, [
    'init',
    'doctor',
    'check',
    'render',
    'build',
    'dev',
    'library',
    'docs',
  ]);
  assert.ok(doctorJson.outputs.includes('glb'));

  const checked = run(['check', foxEntry]);
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  const checkEnvelope = JSON.parse(checked.stdout);
  assert.equal(checkEnvelope.format, 'ashfox-cli-result');
  assert.equal(checkEnvelope.command, 'check');
  const report = checkEnvelope.result.audit;
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.profile, 'creature');
  assert.equal(report.profileSource, 'authored');
  assert.equal(typeof report.score, 'number');
  assert.equal(report.telemetryAvailable, true);
  assert.equal(report.pillars.length, 3);
  assert.equal(report.hardGates.length, 8);

  const retiredCheckProfile = run(['check', foxEntry, '--profile', 'prop']);
  assert.equal(retiredCheckProfile.status, 2);
  const retiredCheckThreshold = run(['check', foxEntry, '--threshold', '10']);
  assert.equal(retiredCheckThreshold.status, 2);
  const retiredSpriteNode = run(['check', spriteEntry, '--node', 'body']);
  assert.equal(retiredSpriteNode.status, 2);

  const spriteInputJson = JSON.stringify({
    name: 'sprites/apple.ashfox',
    source: `ashfox 1
sprite apple {
  import "../module/shared.ashfox" as shared;
  preview inspect { sheet = inspect; }
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
`,
    files: {
      'module/shared.ashfox': `ashfox 1
module shared {
  export material red_skin { ramp { mode = auto; base = #c94040; preset = organic; } }
  export stamp stem { rows = ["ss", ".s"]; slots = ["s"]; }
}
`,
    },
  });
  const spritePass = run(['check', '--input-json'], { input: spriteInputJson });
  assert.equal(spritePass.status, 0, spritePass.stdout + spritePass.stderr);
  assert.equal(JSON.parse(spritePass.stdout).result.audit.passed, true);

  const soundWithPreview = fs
    .readFileSync(path.join(root, 'showcase/assets/sounds/griffin_call.ashfox'), 'utf8')
    .replace('profile = creature;', 'preview inspect { sheet = inspect; }\n  profile = creature;');
  const soundPass = run(['check', '--stdin', '--name', 'griffin_call.ashfox'], {
    input: soundWithPreview,
  });
  assert.equal(soundPass.status, 0, soundPass.stdout + soundPass.stderr);
  assert.equal(JSON.parse(soundPass.stdout).result.audit.passed, true);

  const dirTmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-sheet-')));
  try {
    const spriteSheet = path.join(dirTmp, 'sprite.png');
    const soundSheet = path.join(dirTmp, 'sound.png');
    assert.equal(
      run(['render', '--input-json', '--view', 'inspect', '--output', spriteSheet], {
        input: spriteInputJson,
      }).status,
      0,
    );
    assert.equal(
      run(
        [
          'render',
          '--stdin',
          '--name',
          'griffin_call.ashfox',
          '--view',
          'inspect',
          '--output',
          soundSheet,
        ],
        { input: soundWithPreview },
      ).status,
      0,
    );
    assert.equal(fs.readFileSync(spriteSheet).readUInt32BE(16), 512);
    assert.equal(fs.readFileSync(soundSheet).readUInt32BE(16), 800);
  } finally {
    fs.rmSync(dirTmp, { recursive: true, force: true });
  }

  const lanternCheck = run(['check', lanternEntry]);
  assert.equal(lanternCheck.status, 0, lanternCheck.stdout + lanternCheck.stderr);
  const lanternReport = JSON.parse(lanternCheck.stdout).result.audit;
  assert.equal(lanternReport.profile, 'prop');
  assert.equal(lanternReport.passed, true);

  const retiredRenderSheet = run(['render', foxEntry, '--sheet', 'bogus']);
  assert.equal(retiredRenderSheet.status, 2);

  for (const retired of [
    'export',
    'capabilities',
    'verify',
    'audit',
    'inspect',
    'capture',
    'replay',
    'stdio',
  ]) {
    const res = run([retired]);
    assert.equal(res.status, 2, `${retired} must fail as removed command`);
  }

  verifyDeliveryGates();
  console.log('CLI audit, delivery gate, check unification and retired-command cut passed');
}

function bareBoxSource(profileLine: string): string {
  return `ashfox 1
model box_demo {
  rig contract Rig {
    joint root { parent = none; role = root; channels = rotation; }
  }
  skeleton Skel implements Rig {
    bind root { parent_origin = (0u, 0u, 0u); }
  }
  surface contract Surf { chart body box { coverage = opaque; } material = opaque; }
  surface coat: Surf {
    material = opaque;
    texture atlas {
      background = bg;
      background_alpha = 255;
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
  settings { density = 16; forward = north; ${profileLine} }
  skeleton = Skel;
  use Box as model { skeleton = Rig; skin = coat; }
}`;
}

function verifyDeliveryGates() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-delivery-gate-')));
  try {
    const unprofiled = path.join(dir, 'unprofiled.ashfox');
    fs.writeFileSync(unprofiled, bareBoxSource(''));
    const expUnprofiled = run(['build', unprofiled, '--json']);
    assert.notEqual(expUnprofiled.status, 0);
    assert.match(expUnprofiled.stdout + expUnprofiled.stderr, /quality\.profile-required/);

    const lowCraft = path.join(dir, 'lowcraft.ashfox');
    fs.writeFileSync(lowCraft, bareBoxSource('profile = prop;'));
    const expLowCraft = run(['build', lowCraft, '--json']);
    assert.notEqual(expLowCraft.status, 0);
    assert.match(expLowCraft.stdout + expLowCraft.stderr, /quality\.gate/);

    const pkgDir = path.join(dir, 'ws');
    const wsFile = path.join(pkgDir, '.ashfoxworkspace');
    fs.mkdirSync(path.join(pkgDir, 'assets/models'), { recursive: true });
    fs.writeFileSync(
      wsFile,
      JSON.stringify({
        format: 'ashfox-workspace',
        version: 2,
        name: 'gate-test',
        packages: [
          {
            name: 'src',
            root: 'assets/models',
            manifest: {
              format: 'ashfox-package',
              version: 1,
              dependencies: [],
              entries: [{ name: 'box_demo', path: 'main.ashfox' }],
              modules: [],
            },
          },
        ],
        include: ['assets/**/*.ashfox'],
        ignore: [],
        build: { directory: 'dist/build' },
        exports: [
          {
            name: 'box_demo',
            entry: { packageName: 'src', entryName: 'box_demo' },
            format: 'glb',
            directory: 'dist/models',
          },
        ],
      }),
    );
    fs.writeFileSync(path.join(pkgDir, 'assets/models/main.ashfox'), bareBoxSource(''));
    const checkOk = run(['check', wsFile, '--json'], pkgDir);
    assert.equal(checkOk.status, 0, checkOk.stdout + checkOk.stderr);
    const buildBlocked = run(['build', wsFile, '--json'], pkgDir);
    assert.notEqual(buildBlocked.status, 0);
    assert.match(buildBlocked.stdout + buildBlocked.stderr, /quality\.profile-required/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main()
  .finally(() => fs.rmSync(stageTmp, { recursive: true, force: true }))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
