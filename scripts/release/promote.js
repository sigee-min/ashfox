'use strict';
// Run only after publication. Verify the public release before advancing stable links.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readStable, sync } = require('./stable');
const { hash } = require('./artifacts');
const { isStrictSemVer } = require('./validate');
const root = path.resolve(__dirname, '../..');
const promote = async ({ directory = root, version, release, download }) => {
  if (!isStrictSemVer(version) || version.includes('+')) throw new Error('Invalid release version');
  if (version.includes('-')) return;
  const stable = readStable(directory);
  const compare = (left, right) => {
    const a = left.split('.').map(BigInt), b = right.split('.').map(BigInt);
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  };
  if (compare(version, stable.version) < 0) throw new Error('Cannot move stable release backwards');
  if (release.isDraft !== false || release.isPrerelease !== false) throw new Error('Stable release is not public');
  if (release.tagName !== `v${version}`) throw new Error('Unexpected release tag');
  if (release.isImmutable !== true) throw new Error('Stable release must be immutable');
  for (const name of ['ashfox-cli.tgz', 'starter.zip', 'SHA256SUMS']) {
    const asset = release.assets.find(asset => asset.name === name);
    if (!asset) throw new Error(`Missing public asset: ${name}`);
    const expected = `https://github.com/sigee-min/ashfox/releases/download/v${version}/${name}`;
    if (asset.url !== expected) throw new Error('Unexpected release asset URL');
    const bytes = await download(expected);
    const local = fs.readFileSync(path.join(directory, 'dist/release', name));
    if (hash(bytes) !== hash(local)) throw new Error(`Public download differs: ${name}`);
  }
  // Render and validate the complete next documentation before advancing its authority.
  const base = `https://github.com/sigee-min/ashfox/releases/download/v${version}/`;
  sync(false, directory, { version, cli: base + 'ashfox-cli.tgz', starter: base + 'starter.zip', onboarding: true, grouped: version !== '1.0.0' });
  fs.writeFileSync(path.join(directory, 'scripts/release/stable.json'), JSON.stringify({version}, null, 2) + '\n');
};
const main = async () => {
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
  if (!isStrictSemVer(version)) throw new Error('Invalid release version');
  if (version.includes('-')) return;
  const release = JSON.parse(execFileSync('gh', ['release', 'view', `v${version}`, '--json', 'tagName,isDraft,isPrerelease,isImmutable,assets'], { cwd: root, encoding: 'utf8' }));
  await promote({ version, release, download: async url => {
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error('Public download failed');
    return Buffer.from(await response.arrayBuffer());
  } });
};
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { promote };
