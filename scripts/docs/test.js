'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { unzipSync } = require('fflate');
const root = path.resolve(__dirname, '../..');
const delivery = path.join(root, 'dist/docs-delivery');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-download-test-'));
const run = (exe, args, cwd, options = {}) => {
  const result = spawnSync(exe, args, {
    cwd,
    timeout: 180000,
    maxBuffer: 48 * 1024 * 1024,
    ...options,
  });
  assert.equal(result.status, 0, String(result.stderr) + String(result.stdout).slice(0, 1000));
  return result.stdout;
};
const extract = (name) => {
  const folder = path.join(temp, name);
  const files = unzipSync(fs.readFileSync(path.join(delivery, name + '.zip')));
  for (const [relative, bytes] of Object.entries(files)) {
    assert.ok(!/(^|\/)(node_modules|dist|build|exports|\.ashfox)(\/|$)/.test(relative), relative);
    assert.ok(!relative.split('/').includes('..'), relative);
    const file = path.join(folder, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  }
  return folder;
};
const install = (folder, offline = true) =>
  run(
    'npm',
    [
      'install',
      ...(offline ? ['--offline'] : []),
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--save-dev',
      path.join(delivery, 'ashfox-cli.tgz'),
    ],
    folder,
  );
const cli = (folder, ...args) =>
  run(
    process.execPath,
    [path.join(folder, 'node_modules/@ashfox/cli/dist/ashfox.cjs'), ...args],
    folder,
  );
try {
  const starter = extract('starter');
  install(starter);
  const checked = JSON.parse(
    run(
      'npx',
      ['--no-install', 'ashfox', 'check', 'assets/sprites/sword.ashfox', '--json'],
      starter,
    ),
  );
  assert.equal(checked.ok, true);
  assert.equal(checked.result.kind, 'sprite');
  for (const [source, artifact, magic] of [
    ['assets/models/fox/fox.ashfox', 'fox.glb', 'glTF'],
    ['assets/sprites/sword.ashfox', 'iron_sword.png', '\x89PNG'],
    ['assets/sounds/claw_hit.ashfox', 'claw_hit/base.wav', 'RIFF'],
  ]) {
    const built = JSON.parse(cli(starter, 'build', source, '--json')).result;
    const bytes = fs.readFileSync(path.join(built.exports[0].directory, artifact));
    assert.equal(bytes.subarray(0, 4).toString('latin1'), magic);
  }
  if (process.argv.includes('--capture')) {
    for (const source of ['assets/models/fox/fox.ashfox', 'assets/sprites/sword.ashfox']) {
      const bytes = cli(starter, 'render', source);
      assert.equal(bytes.subarray(0, 4).toString('latin1'), '\x89PNG');
    }
  }
  for (const name of ['items', 'game-assets', 'resource-pack']) {
    const folder = extract(name);
    const checked = JSON.parse(cli(starter, 'check', path.join(folder, '.ashfoxworkspace')));
    assert.equal(checked.ok, true);
  }
  const game = extract('web-game');
  install(game, false);
  run(process.execPath, ['build.mjs'], game);
  const runtime = path.join(game, 'public/game-assets');
  const manifest = JSON.parse(fs.readFileSync(path.join(runtime, 'assets.json')));
  assert.equal(manifest.format, 'ashfox-game-assets');
  assert.deepEqual(manifest.assets.map((a) => a.id).sort(), [
    'creature.griffin',
    'item.iron_sword',
    'sfx.claw_hit',
  ]);
  for (const asset of manifest.assets) {
    for (const file of [
      asset.model,
      asset.image,
      ...(asset.variants ?? []).map((v) => v.file),
    ].filter(Boolean)) {
      assert.ok(fs.statSync(path.join(runtime, file)).size > 0, file);
    }
  }
  fs.writeFileSync(path.join(runtime, 'obsolete.txt'), 'stale');
  run(process.execPath, ['build.mjs'], game);
  assert.equal(fs.existsSync(path.join(runtime, 'obsolete.txt')), false);
  console.log(
    'Downloaded CLI installs offline; starter exports, complete projects and web-game build pass' +
      (process.argv.includes('--capture') ? '; stdio edit/cancel/capture PNG passes' : ''),
  );
  if (process.env.ASHFOX_KEEP_DOC_TEST) console.log('Retained test project: ' + game);
} finally {
  if (!process.env.ASHFOX_KEEP_DOC_TEST) fs.rmSync(temp, { recursive: true, force: true });
}
