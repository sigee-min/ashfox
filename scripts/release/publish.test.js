'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { publish, releaseNotes } = require('./publish');
const { names, hash } = require('./artifacts');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-publish-test-'));
const sha = 'a'.repeat(40);
const fixture = () => {
  let release = null;
  const bytes = new Map();
  const calls = [];
  const api = async (url, options = {}) => {
    calls.push([url, options.method || 'GET']);
    if (url.includes('/tags/')) return release;
    if (url.endsWith('/releases') && options.method === 'POST') {
      release = { ...options.json, id: 1, assets: [], upload_url: 'https://uploads.github.com/test{?name}' };
      return release;
    }
    if (options.bytes) {
      const asset = { id: release.assets.length + 1, name: new URL(url).searchParams.get('name') };
      bytes.set(asset.id, options.bytes);
      release.assets.push(asset);
      return asset;
    }
    if (options.binary) return bytes.get(Number(url.split('/').pop()));
    if (options.method === 'PATCH') { Object.assign(release, options.json, { immutable: true }); return release; }
    throw new Error(`Unexpected API call ${url}`);
  };
  return { api, calls, bytes, get release() { return release; } };
};
const main = async () => {
  for (const name of names) fs.writeFileSync(path.join(directory, name), name);
  fs.writeFileSync(path.join(directory, 'SHA256SUMS'), names.map(name => `${hash(Buffer.from(name))}  ${name}\n`).join(''));
  fs.mkdirSync(path.join(directory, '.github'));
  fs.writeFileSync(path.join(directory, '.github/CHANGELOG.md'), '# Changelog\n\n## [1.2.3] new\n\n### Breaking changes\nNew contract\n\n## [1.2.2] old\nold history');
  const changelog = releaseNotes(directory, '1.2.3');
  assert.match(changelog, /New contract/);
  assert.doesNotMatch(changelog, /old history/);
  assert.throws(() => releaseNotes(directory, '9.0.0'), /missing/);
  const run = api => publish({ api, repository: 'owner/repo', sha, version: '1.2.3', directory, changelog });
  const state = fixture();
  await run(state.api);
  assert.equal(state.release.draft, false);
  assert.match(state.release.body, /New contract/);
  assert.match(state.release.body, /ashfox --version/);
  assert.match(state.release.body, /ashfox init assets/);
  assert.match(state.release.body, /ashfox doctor/);
  assert.doesNotMatch(state.release.body, /ashfox capabilities|Download starter.zip/);
  assert.equal(state.release.assets.length, names.length + 1);
  assert.equal(state.calls.at(-1)[1], 'PATCH', 'publish follows every download verification');
  state.calls.length = 0;
  await run(state.api);
  assert.ok(state.calls.every(([, method]) => method === 'GET'), 'published retry is read-only');
  state.release.immutable = false;
  await assert.rejects(run(state.api), /immutability/);
  state.release.immutable = true;
  state.bytes.set(1, Buffer.from('corrupt'));
  await assert.rejects(run(state.api), /refusing overwrite/);
  state.release.assets.pop();
  state.bytes.set(1, Buffer.from(names[0]));
  await assert.rejects(run(state.api), /publish a new version/);
  const interrupted = fixture();
  await assert.rejects(run(async (url, options) => {
    if (options?.bytes) throw new Error('upload interrupted');
    return interrupted.api(url, options);
  }), /upload interrupted/);
  assert.equal(interrupted.release.draft, true);
  interrupted.release.body = 'outdated draft instructions';
  await run(interrupted.api);
  assert.match(interrupted.release.body, /ashfox init assets/);
  assert.equal(interrupted.release.draft, false);
  interrupted.release.draft = true;
  interrupted.release.target_commitish = 'b'.repeat(40);
  await assert.rejects(run(interrupted.api), /different commit/);
  await assert.rejects(run(async () => { throw new Error('API unavailable'); }), /API unavailable/);
  await assert.rejects(publish({ api: fixture().api, repository: 'owner/repo', sha,
    version: '1.2.3', directory }), /changelog entry missing/);
  const mutable = fixture();
  await assert.rejects(run(async (url, options) => {
    const value = await mutable.api(url, options);
    return options?.method === 'PATCH' ? { ...value, immutable: false } : value;
  }), /immutability/);
  fs.writeFileSync(path.join(directory, names[0]), 'bad local bytes');
  await assert.rejects(run(state.api), /checksum mismatch/);
  console.log('Release publication: verified draft, interruption/retry, immutable assets and failures pass');
};
main().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => fs.rmSync(directory, { recursive: true, force: true }));
