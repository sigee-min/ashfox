'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { isStrictSemVer } = require('./validate');

const packageCli = (root, out) => {
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
  if (!isStrictSemVer(version)) throw new Error('Invalid product version');
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-package-'));
  try {
    execFileSync(process.execPath, [path.join(root, 'apps/cli/build.js')], { cwd: root, stdio: 'inherit' });
    fs.mkdirSync(path.join(stage, 'dist'));
    for (const [source, target] of [
      ['apps/cli/dist/ashfox.cjs', 'dist/ashfox.cjs'],
      ['apps/cli/README.md', 'README.md'], ['LICENSE', 'LICENSE']
    ]) fs.copyFileSync(path.join(root, source), path.join(stage, target));
    fs.chmodSync(path.join(stage, 'dist/ashfox.cjs'), 0o755);
    fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({
      name: '@ashfox/cli', version, description: 'Assets as Code for voxel games',
      license: 'MIT', engines: { node: '>=20' }, bin: { ashfox: 'dist/ashfox.cjs' },
      files: ['dist/ashfox.cjs', 'README.md', 'LICENSE'],
      repository: { type: 'git', url: 'https://github.com/sigee-min/ashfox.git' }
    }, null, 2) + '\n');
    fs.mkdirSync(out, { recursive: true });
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const result = JSON.parse(execFileSync(npm, ['pack', '--ignore-scripts', '--json'], {
      cwd: stage, encoding: 'utf8', shell: process.platform === 'win32'
    }));
    fs.copyFileSync(path.join(stage, result[0].filename), path.join(out, 'ashfox-cli.tgz'));
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
};
module.exports = { packageCli };
