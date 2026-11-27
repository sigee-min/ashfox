'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { unzipSync } = require('fflate');
const { verify } = require('./artifacts');
const root = path.resolve(__dirname, '../..');
const directory = path.resolve(process.argv[2] || path.join(root, 'dist/release'));
const temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ashfox-release-smoke-'));
const run = (exe, args, cwd, input) =>
  new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      cwd,
      shell: process.platform === 'win32' && ['npm', 'npx'].includes(exe),
      env: { ...process.env, npm_config_cache: path.join(temp, 'cache') },
      timeout: 120000,
    });
    const stdout = [],
      stderr = [];
    child.stdout.on('data', (bytes) => stdout.push(bytes));
    child.stderr.on('data', (bytes) => stderr.push(bytes));
    child.stdin.end(input);
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve(Buffer.concat(stdout))
        : reject(new Error(`${exe} failed (${code}): ${Buffer.concat(stderr)}`)),
    );
  });
const startTgzServer = async (dir) => {
  const server = http.createServer((request, response) => {
    if (request.url !== '/ashfox-cli.tgz') {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Content-Type', 'application/octet-stream');
    response.end(fs.readFileSync(path.join(dir, 'ashfox-cli.tgz')));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
};

const extractStarterZip = (dir, folder) => {
  fs.mkdirSync(folder);
  const archive = unzipSync(fs.readFileSync(path.join(dir, 'starter.zip')));
  for (const [name, bytes] of Object.entries(archive)) {
    assert.ok(!name.split('/').includes('..') && !path.isAbsolute(name));
    const file = path.join(folder, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  }
};

const verifyInstalledCliMetadata = (folder) => {
  const metadata = JSON.parse(
    fs.readFileSync(path.join(folder, 'node_modules/@ashfox/cli/package.json')),
  );
  const rootManifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
  assert.equal(metadata.version, rootManifest.version);
  assert.deepEqual(metadata.engines, rootManifest.engines);
  assert.equal(metadata.scripts, undefined);
  assert.equal(metadata.dependencies, undefined);
  assert.ok(fs.existsSync(path.join(folder, 'node_modules/@ashfox/cli/LICENSE')));
  require('./sound').verifySoundCli(path.join(folder, 'node_modules/@ashfox/cli/dist/ashfox.cjs'));
  return metadata;
};

const verifyCreatedProject = async (execute, folder) => {
  await execute('init', 'created', '--json');
  for (const [name, source] of Object.entries(require('./project').projectFiles(root))) {
    assert.equal(
      fs.readFileSync(path.join(folder, 'created', name), 'utf8'),
      source,
      'offline init matches the grouped project template',
    );
  }
  const built = JSON.parse(await execute('build', 'created/.ashfoxworkspace.mjs', '--json')).result;
  const verified = JSON.parse(
    await execute('check', 'created/build/assets/compiler', '--json'),
  ).result;
  assert.equal(built.bundleHash, verified.bundleHash);
  assert.equal(verified.catalog.assets.length, 5);
  const adapted = JSON.parse(
    await run(
      process.execPath,
      ['created/assets.mjs', path.join(folder, 'node_modules/@ashfox/cli/dist/ashfox.cjs')],
      folder,
    ),
  );
  assert.equal(adapted.bundleHash, built.bundleHash);
  const builtSword = JSON.parse(
    await execute('build', 'created/assets/sprites/iron_sword.ashfox', '--json'),
  ).result;
  const swordExport = builtSword.exports.find((item) => item.id === 'items_iron_sword');
  assert.ok(swordExport);
  const png = fs.readFileSync(path.join(swordExport.directory, 'items_iron_sword.png'));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  await assert.rejects(execute('export', 'created/assets/sprites/iron_sword.ashfox'));
  const checkedSword = JSON.parse(
    (await execute('check', 'created/assets/sprites/iron_sword.ashfox', '--json')).toString(),
  );
  assert.equal(checkedSword.ok, true);
  assert.equal(JSON.parse(await execute('doctor', '--json')).ok, true);
};

const verifyStandaloneBuilds = async (execute) => {
  const cases = [
    ['assets/models/wall_lantern.ashfox', 'wall_lantern.glb', 'glTF'],
    ['assets/sprites/iron_sword.ashfox', 'iron_sword.png', '\x89PNG'],
    ['assets/sounds/claw_hit.ashfox', 'claw_hit/base.wav', 'RIFF'],
  ];
  for (const [source, artifact, magic] of cases) {
    const standaloneBuilt = JSON.parse(
      (await execute('build', source, '--json')).toString(),
    ).result;
    const firstDir = standaloneBuilt.exports[0].directory;
    assert.equal(
      fs.readFileSync(path.join(firstDir, artifact)).subarray(0, 4).toString('latin1'),
      magic,
    );
  }
};

const verifyInstallationMode = async (dir, server, mode) => {
  const folder = path.join(temp, mode);
  extractStarterZip(dir, folder);
  fs.copyFileSync(path.join(dir, 'ashfox-cli.tgz'), path.join(folder, 'ashfox-cli.tgz'));
  const target =
    mode === 'url'
      ? `http://127.0.0.1:${server.address().port}/ashfox-cli.tgz`
      : './ashfox-cli.tgz';
  await run(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--save-dev',
      ...(mode === 'offline' ? ['--offline'] : []),
      target,
    ],
    folder,
  );
  const metadata = verifyInstalledCliMetadata(folder);
  const execute = (...args) => run('npx', ['--no-install', '--offline', 'ashfox', ...args], folder);
  assert.equal((await execute('--version')).toString().trim(), metadata.version);
  assert.match((await execute('--help')).toString(), /init <new-folder>/);
  assert.equal(JSON.parse(await execute('doctor', '--json')).ok, true);
  await verifyCreatedProject(execute, folder);
  await verifyStandaloneBuilds(execute);
  fs.rmSync(path.join(folder, 'node_modules'), { recursive: true });
  await run('npm', ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], folder);
  assert.equal(JSON.parse(await execute('doctor', '--json')).ok, true);
};

const main = async () => {
  verify(directory);
  const server = await startTgzServer(directory);
  try {
    for (const mode of ['url', 'offline']) {
      await verifyInstallationMode(directory, server, mode);
    }
    console.log('Release URL/offline installation, version, exports and lockfile restoration pass');
  } finally {
    server.close();
  }
};
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(temp, { recursive: true, force: true }));
