'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
const cli = path.join(__dirname, '../../dist/ashfox.cjs');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-config-'));
const root = path.join(temp, 'game');
const run = (...args: string[]) => {
  const result = spawnSync(process.execPath, [cli, ...args, '--json'], {
    encoding: 'utf8',
    timeout: 60000,
  });
  return { status: result.status, report: JSON.parse(String(result.stdout)) };
};
try {
  assert.equal(run('init', root).status, 0);
  const file = path.join(root, '.ashfoxworkspace.mjs');
  const initial = fs.readFileSync(file, 'utf8');
  const first = run('build', file);
  assert.equal(first.status, 0, JSON.stringify(first.report));
  assert.equal(first.report.result.exports.length, 3);
  assert.ok(
    first.report.result.exports.every((item: { directory: string }) =>
      item.directory.startsWith(path.join(fs.realpathSync(root), 'build')),
    ),
  );
  const second = run('build', file);
  assert.equal(second.report.result.bundleHash, first.report.result.bundleHash);
  assert.equal(run('check', path.join(root, 'asset/items/sword.ashfox')).status, 0);
  const adapted = spawnSync(process.execPath, [path.join(root, 'assets.mjs'), cli], {
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.equal(adapted.status, 0, adapted.stderr);
  assert.equal(JSON.parse(String(adapted.stdout)).bundleHash, first.report.result.bundleHash);
  const consumer = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { pathToFileURL } from 'node:url';
    import fs from 'node:fs';
    const { buildAssets } = await import(pathToFileURL(process.argv[1]).href);
    const built = buildAssets(process.argv[2]);
    const item = built.catalog.assets.find(asset => asset.id === 'items_iron_sword');
    const file = item.files.find(file => file.path.endsWith('.png'));
    const target = built.file(item.id, file.path.slice(('assets/' + item.id + '/').length));
    if (!fs.existsSync(target)) throw new Error('Missing file');
    let rejected = false;
    try { built.file('missing', '../other.png'); } catch { rejected = true; }
    if (!rejected) throw new Error('Unknown file accepted');
  `,
      path.join(root, 'assets.mjs'),
      cli,
    ],
    { encoding: 'utf8', timeout: 60000 },
  );
  assert.equal(consumer.status, 0, consumer.stderr);
  fs.writeFileSync(file, initial.replace('build/assets/compiler', 'build/custom/compiler'));
  const customized = spawnSync(process.execPath, [path.join(root, 'assets.mjs'), cli], {
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.equal(customized.status, 0, customized.stderr);
  assert.ok(
    JSON.parse(String(customized.stdout)).bundlePath.includes(
      path.join('build', 'custom', 'compiler'),
    ),
  );
  fs.writeFileSync(file, initial);
  const pointer = path.join(root, 'build/assets/compiler/current.json');
  const before = fs.readFileSync(pointer, 'utf8');
  fs.writeFileSync(
    file,
    initial.replace("name: 'game-assets'", "name: 'game-assets', unknown: true"),
  );
  assert.notEqual(run('build', file).status, 0);
  assert.equal(fs.readFileSync(pointer, 'utf8'), before);
  fs.writeFileSync(
    file,
    "import fs from 'node:fs'; const count = Number(fs.existsSync('count') ? fs.readFileSync('count', 'utf8') : 0) + 1; fs.writeFileSync('count', String(count));\n" +
      initial.replace("name: 'game-assets'", "name: 'game-' + count"),
  );
  assert.equal(run('build', file).report.diagnostics[0].code, 'source.changed');
  assert.equal(fs.readFileSync(pointer, 'utf8'), before);
  fs.unlinkSync(path.join(root, 'count'));
  fs.writeFileSync(file, 'throw new Error("configuration failure");');
  assert.equal(run('build', file).report.diagnostics[0].code, 'workspace.evaluate');
  fs.writeFileSync(file, initial);
  fs.writeFileSync(path.join(root, '.ashfoxworkspace'), '{}');
  assert.equal(run('build', file).report.diagnostics[0].code, 'workspace.ambiguous');
  fs.unlinkSync(path.join(root, '.ashfoxworkspace'));
  const outside = path.join(temp, 'external.mjs');
  fs.writeFileSync(
    outside,
    "import fs from 'node:fs'; fs.writeFileSync('EXECUTED', 'bad');\n" + initial,
  );
  fs.unlinkSync(file);
  fs.symlinkSync(outside, file);
  assert.equal(
    run('check', path.join(root, 'asset/items/sword.ashfox')).report.diagnostics[0].code,
    'path.symlink',
  );
  assert.equal(fs.existsSync(path.join(root, 'EXECUTED')), false);
  fs.unlinkSync(file);
  fs.writeFileSync(file, initial);
  fs.rmSync(path.join(root, 'build'), { recursive: true });
  assert.equal(run('build', file).report.result.bundleHash, first.report.result.bundleHash);
  console.log(
    'Executable workspace: grouped starter, adapter, clean rebuild, invalid config and ambiguity pass',
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
