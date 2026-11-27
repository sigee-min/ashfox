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
      ['--no-install', 'ashfox', 'check', 'assets/sprites/iron_sword.ashfox', '--json'],
      starter,
    ),
  );
  assert.equal(checked.ok, true);
  assert.equal(checked.result.kind, 'sprite');
  for (const [source, artifact, magic] of [
    ['assets/models/wall_lantern.ashfox', 'wall_lantern.glb', 'glTF'],
    ['assets/sprites/iron_sword.ashfox', 'iron_sword.png', '\x89PNG'],
    ['assets/sounds/claw_hit.ashfox', 'claw_hit/base.wav', 'RIFF'],
  ]) {
    const built = JSON.parse(cli(starter, 'build', source, '--json')).result;
    const bytes = fs.readFileSync(path.join(built.exports[0].directory, artifact));
    assert.equal(bytes.subarray(0, 4).toString('latin1'), magic);
  }
  if (process.argv.includes('--capture')) {
    for (const source of [
      'assets/models/wall_lantern.ashfox',
      'assets/sprites/iron_sword.ashfox',
    ]) {
      const bytes = cli(starter, 'render', source);
      assert.equal(bytes.subarray(0, 4).toString('latin1'), '\x89PNG');
    }
  }
  const showcaseDir = extract('showcase');
  const checkedShowcase = JSON.parse(
    cli(starter, 'check', path.join(showcaseDir, '.ashfoxworkspace'), '--json'),
  );
  assert.equal(checkedShowcase.ok, true);
  const builtShowcase = JSON.parse(
    cli(starter, 'build', path.join(showcaseDir, '.ashfoxworkspace'), '--json'),
  ).result;
  const gameExport = builtShowcase.exports.find((entry) => entry.id === 'voxel_game');
  assert.ok(gameExport, 'Missing voxel_game pack export');
  const manifest = JSON.parse(
    fs.readFileSync(path.join(gameExport.directory, 'game-assets/assets.json'), 'utf8'),
  );
  assert.equal(manifest.format, 'ashfox-game-assets');
  assert.ok(manifest.assets.some((a) => a.id === 'creature.griffin_boss'));
  assert.ok(manifest.assets.some((a) => a.id === 'item.iron_sword'));
  assert.ok(manifest.assets.some((a) => a.id === 'sfx.claw_hit'));
  const webGameDir = extract('web-game');
  for (const required of [
    'package.json',
    'build.mjs',
    'serve.mjs',
    'index.html',
    'main.js',
    'assets/.ashfoxworkspace',
  ]) {
    assert.ok(fs.existsSync(path.join(webGameDir, required)), `web-game missing ${required}`);
  }
  run(process.execPath, ['build.mjs'], webGameDir, {
    env: {
      ...process.env,
      ASHFOX_CLI: path.join(starter, 'node_modules/@ashfox/cli/dist/ashfox.cjs'),
    },
  });
  const webManifest = JSON.parse(
    fs.readFileSync(path.join(webGameDir, 'public/game-assets/assets.json'), 'utf8'),
  );
  assert.ok(webManifest.assets.some((a) => a.id === 'creature.griffin_boss'));
  assert.ok(webManifest.assets.some((a) => a.id === 'item.iron_sword'));
  assert.ok(webManifest.assets.some((a) => a.id === 'sfx.claw_hit'));
  console.log(
    'Downloaded CLI installs offline; starter exports and complete showcase project build pass' +
      (process.argv.includes('--capture') ? '; stdio edit/cancel/capture PNG passes' : ''),
  );
  if (process.env.ASHFOX_KEEP_DOC_TEST) console.log('Retained test project: ' + showcaseDir);
} finally {
  if (!process.env.ASHFOX_KEEP_DOC_TEST) fs.rmSync(temp, { recursive: true, force: true });
}
