'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const root = path.resolve(__dirname, '../../../..');
const cli = path.join(__dirname, '../../dist/ashfox.cjs');
const foxEntry = path.join(root, 'examples/fox/creatures/fox.ashfox');
const lanternEntry = path.join(root, 'examples/prop/lantern.ashfox');
const spriteEntry = path.join(root, 'examples/items/src/apple.ashfox');

const run = (args: string[], cwd = root) =>
  spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
  });

async function main() {
  const caps = run(['capabilities']);
  assert.equal(caps.status, 0, caps.stderr);
  const capsJson = JSON.parse(caps.stdout).result;
  assert.ok(capsJson.commands.includes('audit'));
  assert.ok(capsJson.observation.methods.includes('audit'));

  const audited = run(['audit', foxEntry]);
  assert.equal(audited.status, 0, audited.stderr);
  const report = JSON.parse(audited.stdout);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.profile, 'creature');
  assert.equal(report.profileSource, 'authored');
  assert.equal(typeof report.score, 'number');
  assert.equal(report.telemetryAvailable, true);
  assert.equal(report.pillars.length, 3);
  assert.equal(report.hardGates.length, 8);

  const overridden = run(['audit', foxEntry, '--profile', 'prop', '--threshold', '10']);
  assert.equal(overridden.status, 0, overridden.stderr);
  const propReport = JSON.parse(overridden.stdout);
  assert.equal(propReport.profile, 'prop');
  assert.equal(propReport.profileSource, 'override');
  assert.equal(propReport.threshold, 10);

  const inspected = run(['inspect', foxEntry]);
  assert.equal(inspected.status, 0, inspected.stderr);
  const inspectJson = JSON.parse(inspected.stdout);
  assert.ok(inspectJson.audit);
  assert.equal(inspectJson.audit.score, report.score);

  const spriteAudit = run(['audit', spriteEntry]);
  assert.notEqual(spriteAudit.status, 0);
  assert.match(spriteAudit.stderr, /observe\.kind/);

  const child = spawn(process.execPath, [cli, 'stdio'], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buf = '';
  const waiting = new Map<
    string,
    (reply: { ok: boolean; result?: Record<string, unknown>; error?: { code: string } }) => void
  >();
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, idx));
      buf = buf.slice(idx + 1);
      waiting.get(msg.id)?.(msg);
      waiting.delete(msg.id);
    }
  });
  const call = (id: string, method: string, params = {}) =>
    new Promise<{ ok: boolean; result?: Record<string, unknown>; error?: { code: string } }>(
      (resolve) => {
        waiting.set(id, resolve);
        child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
      },
    );

  const loaded = await call('1', 'load', { input: { file: foxEntry } });
  assert.equal(loaded.ok, true);
  const rev = loaded.result!.revision as string;

  const stdioAudit = await call('2', 'audit', { profile: 'creature', threshold: 70 });
  assert.equal(stdioAudit.ok, true);
  assert.equal(stdioAudit.result!.revision, rev);
  assert.equal(stdioAudit.result!.threshold, 70);

  const staleAudit = await call('3', 'audit', { expectedRevision: 'stale-rev' });
  assert.equal(staleAudit.ok, false);
  assert.equal(staleAudit.error?.code, 'observe.stale');

  const badParam = await call('4', 'audit', { unknownFlag: true });
  assert.equal(badParam.ok, false);
  assert.equal(badParam.error?.code, 'observe.contract');

  const exit = new Promise((resolve) => child.on('exit', resolve));
  child.stdin.end();
  assert.equal(await exit, 0);

  const lanternAudit = run(['audit', lanternEntry]);
  assert.equal(lanternAudit.status, 0, lanternAudit.stderr);
  const lanternReport = JSON.parse(lanternAudit.stdout);
  assert.equal(lanternReport.profile, 'prop');
  assert.equal(lanternReport.passed, true);

  const badSheet = run(['capture', foxEntry, '--sheet', 'bogus']);
  assert.notEqual(badSheet.status, 0);
  assert.match(badSheet.stderr, /observe\.option/);

  verifyDeliveryGates();
  console.log('CLI audit, delivery gate, inspect.audit and stdio audit protocol passed');
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
    const expUnprofiled = run(['export', unprofiled]);
    assert.notEqual(expUnprofiled.status, 0);
    assert.match(expUnprofiled.stderr, /quality\.profile-required/);

    const lowCraft = path.join(dir, 'lowcraft.ashfox');
    fs.writeFileSync(lowCraft, bareBoxSource('profile = prop;'));
    const expLowCraft = run(['export', lowCraft]);
    assert.notEqual(expLowCraft.status, 0);
    assert.match(expLowCraft.stderr, /quality\.gate/);

    const pkgDir = path.join(dir, 'ws');
    const wsFile = path.join(pkgDir, '.ashfoxworkspace');
    fs.mkdirSync(path.join(pkgDir, 'src'), { recursive: true });
    fs.writeFileSync(
      wsFile,
      JSON.stringify({
        format: 'ashfox-workspace',
        version: 2,
        name: 'gate-test',
        packages: [
          {
            name: 'src',
            root: 'src',
            manifest: {
              format: 'ashfox-package',
              version: 1,
              dependencies: [],
              entries: [{ name: 'box_demo', path: 'main.ashfox' }],
              modules: [],
            },
          },
        ],
        include: ['**/*.ashfox'],
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
    fs.writeFileSync(path.join(pkgDir, 'src/main.ashfox'), bareBoxSource(''));
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
