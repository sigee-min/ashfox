'use strict';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const root = path.resolve(__dirname, '../../../..');
const cli = path.join(__dirname, '../../dist/ashfox.cjs');
const foxEntry = path.join(root, 'examples/fox/creatures/fox.ashfox');
const spriteEntry = path.join(root, 'examples/items/src/apple.ashfox');

const run = (args: string[]) =>
  spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
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
  assert.equal(report.profileSource, 'inferred');
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
  console.log('CLI audit, capabilities, inspect.audit and stdio audit protocol passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
