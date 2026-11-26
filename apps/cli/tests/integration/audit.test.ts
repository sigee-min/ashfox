'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(__dirname, '../../../..');
const cli = path.join(__dirname, '../../dist/ashfox.cjs');
const foxEntry = path.join(root, 'examples/fox/creatures/fox.ashfox');
const lanternEntry = path.join(root, 'examples/prop/lantern.ashfox');
const spriteEntry = path.join(root, 'examples/items/assets/sprites/apple.ashfox');

const run = (args: string[], cwd = root) =>
  spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
  });

async function main() {
  const doctor = run(['doctor', '--json']);
  assert.equal(doctor.status, 0, doctor.stderr);
  const doctorJson = JSON.parse(doctor.stdout).result;
  assert.deepEqual(doctorJson.commands, ['init', 'doctor', 'check', 'render', 'build']);
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
  return `ashfox-model 1
asset box_demo {
  export rig contract Rig {
    handedness = right;
    frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
    joint root { parent = none; role = root; frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } channels = rotation; mirror = none; }
  }
  export skeleton Skel implements Rig {
    bind root { parent-origin = (0u, 0u, 0u); frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } }
  }
  export surface contract Surf { chart body box { coverage = opaque; } material = opaque; }
  export surface coat: Surf {
    material = opaque;
    texture atlas {
      background = bg;
      background-alpha = 255;
      palette { bg = #101014; tone = (#7a5230, #9a6e44, #bc8e60); }
      chart body box { fill = tone; }
    }
  }
  export component Box {
    requires rig skeleton: Rig;
    requires surface skin: Surf;
    bind bone root to skeleton.root;
    geometry { bone root { cube body { origin = (-4u, 0u, -4u); size = (8u, 8u, 8u); surface = skin.body; } } }
  }
  export asset box_demo {
    settings { density = 16; forward = north; ${profileLine} }
    skeleton = Skel;
    use Box as model { bind skeleton = Rig; bind skin = coat; };
  }
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
