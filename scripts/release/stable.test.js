'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { readStable, sync } = require('./stable');
const { promote } = require('./promote');
const root = path.resolve(__dirname, '../..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-stable-'));
const write = (name, value) => {
  const file = path.join(directory, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
};
const read = name => fs.readFileSync(path.join(directory, name), 'utf8');
const documents = ['README.md', 'docs/guides/install.md', 'docs/guides/cli.md'];
const main = async () => {
  write('scripts/release/stable.json', '{"version":"1.0.0"}');
  for (const name of documents) write(name, fs.readFileSync(path.join(root, name), 'utf8'));
  sync(false, directory);
  assert.equal(readStable(directory).onboarding, true);
  const originalReadme = read('README.md');
  assert.match(read('docs/guides/install.md'), /ashfox init assets/);
  write('docs/guides/install.md', read('docs/guides/install.md').replaceAll('/v1.0.0/', '/v0.9.0/'));
  assert.throws(() => sync(true, directory), /Stale/);
  sync(false, directory);
  sync(true, directory);
  const assets = ['ashfox-cli.tgz', 'starter.zip', 'SHA256SUMS'].map(name => ({ name,
    url: `https://github.com/sigee-min/ashfox/releases/download/v1.1.0/${name}` }));
  for (const asset of assets) write(`dist/release/${asset.name}`, asset.name);
  const release = { tagName: 'v1.1.0', isDraft: false, isPrerelease: false, isImmutable: true, assets };
  const options = { directory, version: '1.1.0', release, download: async url => Buffer.from(url.split('/').pop()) };
  for (const [change, error] of [
    [{ isDraft: true }, /not public/], [{ isPrerelease: true }, /not public/],
    [{ isDraft: undefined }, /not public/], [{ isImmutable: false }, /immutable/],
    [{ tagName: 'v1.0.0' }, /tag/], [{ assets: assets.slice(1) }, /Missing/],
    [{ assets: [{ ...assets[0], url: 'https://example.com/cli' }, ...assets.slice(1)] }, /URL/]
  ]) await assert.rejects(promote({ ...options, release: { ...release, ...change } }), error);
  await assert.rejects(promote({ ...options, download: async () => Buffer.from('bad') }), /differs/);
  assert.equal(readStable(directory).version, '1.0.0');
  const originalGuide = read('docs/guides/install.md');
  const originalCli = read('docs/guides/cli.md');
  write('docs/guides/cli.md', originalCli.replace('<!-- ashfox:availability -->', ''));
  await assert.rejects(promote(options), /Missing or duplicate/);
  assert.equal(readStable(directory).version, '1.0.0');
  assert.equal(read('docs/guides/install.md'), originalGuide, 'invalid document does not partially update earlier documents');
  write('docs/guides/cli.md', originalCli);
  await promote(options);
  assert.equal(readStable(directory).version, '1.1.0');
  assert.equal(readStable(directory).onboarding, true);
  for (const file of ['docs/guides/install.md']) {
    assert.match(read(file), /v1.1.0/);
    assert.match(read(file), /ashfox --version/);
    assert.match(read(file), /ashfox init assets/);
    assert.match(read(file), /assets\/asset\/items\/sword.ashfox/);
    assert.doesNotMatch(read(file), /ashfox capabilities|Download and extract|published 1.0.0/);
  }
  assert.equal(read('README.md'), originalReadme, 'release promotion leaves the product README unchanged');
  assert.match(read('docs/guides/install.md'), /ashfox doctor/);
  assert.doesNotMatch(read('docs/guides/cli.md'), /published 1.0.0/);
  sync(true, directory);
  await promote(options);
  await assert.rejects(promote({ ...options, version: '1.0.0' }), /backwards/);
  await promote({ ...options, version: '1.2.0-rc.1', download: async () => assert.fail('prerelease download') });
  assert.equal(readStable(directory).version, '1.1.0');
  for (const version of ['1.0.1', '1.1.0', '2.0.0']) {
    write('scripts/release/stable.json', JSON.stringify({ version }));
    assert.equal(readStable(directory).onboarding, true);
  }
  for (const record of [{ version: '1.1.0', extra: true }, { version: '1.1.0-rc.1' }, { version: '1.1.0+build.1' }]) {
    write('scripts/release/stable.json', JSON.stringify(record));
    assert.throws(() => readStable(directory), /one stable/);
  }
  console.log('Stable promotion: public immutable bytes, complete first-run docs, retry and failure preservation pass');
};
main().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => fs.rmSync(directory, { recursive: true, force: true }));
