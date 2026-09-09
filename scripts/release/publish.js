'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { names, hash, verify } = require('./artifacts');
const { isStrictSemVer } = require('./validate');

const publish = async ({ api, repository, sha, version, directory }) => {
  if (!isStrictSemVer(version) || !/^[a-f0-9]{40}$/.test(sha) ||
      !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid release identity');
  verify(directory);
  const tag = `v${version}`;
  const base = `/repos/${repository}/releases`;
  const files = [...names, 'SHA256SUMS'];
  let release = await api(`${base}/tags/${tag}`, { allowMissing: true });
  if (!release) release = await api(base, { method: 'POST', json: {
    tag_name: tag, target_commitish: sha, name: tag, draft: true,
    prerelease: version.includes('-'), body: `Install the CLI (Node.js 20+):\n\n\`\`\`sh\nnpm install --save-dev https://github.com/${repository}/releases/download/${tag}/ashfox-cli.tgz\nnpx --no-install ashfox capabilities\n\`\`\`\n\nDownload starter.zip, extract it, and run the install command inside that folder.\n\nCLI, starter sources and SHA256SUMS were built from ${sha}.\nChrome is optional for capture; FFmpeg is optional for OGG audio.`
  } });
  if (release.draft && release.target_commitish !== sha) throw new Error('Draft belongs to a different commit');
  for (const name of files) {
    const bytes = fs.readFileSync(path.join(directory, name));
    let asset = release.assets.find(item => item.name === name);
    if (!asset) {
      if (!release.draft) throw new Error(`Published release is missing ${name}; publish a new version`);
      asset = await api(release.upload_url.split('{')[0] + `?name=${encodeURIComponent(name)}`, {
        method: 'POST', bytes
      });
    }
    const downloaded = await api(`${base}/assets/${asset.id}`, { binary: true });
    if (hash(downloaded) !== hash(bytes)) throw new Error(`Remote asset differs: ${name}; refusing overwrite`);
  }
  if (release.draft) await api(`${base}/${release.id}`, { method: 'PATCH', json: {
    draft: false, make_latest: version.includes('-') ? 'false' : 'true'
  } });
  console.log(`Release verified: https://github.com/${repository}/releases/tag/${tag}`);
};

const main = async () => {
  const root = path.resolve(__dirname, '../..');
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
  if (!isStrictSemVer(version)) throw new Error('Invalid version');
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const tag = spawnSync('git', ['rev-parse', '--verify', `refs/tags/v${version}^{commit}`], { cwd: root, encoding: 'utf8' });
  if (tag.status === 0 && tag.stdout.trim() !== sha) throw new Error('Version tag already belongs to another commit; prepare a new release');
  if (tag.status !== 0 && tag.status !== 128) throw new Error('Cannot inspect release tag');
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error('GH_TOKEN is required');
  const api = async (endpoint, options = {}) => {
    const url = new URL(endpoint, 'https://api.github.com');
    if (!['api.github.com', 'uploads.github.com'].includes(url.hostname)) throw new Error('Unexpected GitHub API host');
    const response = await fetch(url, {
      method: options.method || 'GET', signal: AbortSignal.timeout(120000),
      headers: { Authorization: `Bearer ${token}`, Accept: options.binary ? 'application/octet-stream' : 'application/vnd.github+json',
        'Content-Type': options.bytes ? 'application/octet-stream' : 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
      body: options.bytes || (options.json ? JSON.stringify(options.json) : undefined)
    });
    if (options.allowMissing && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub API failed: ${response.status} ${url.pathname}`);
    return options.binary ? Buffer.from(await response.arrayBuffer()) : response.json();
  };
  await publish({ api, repository: process.env.GITHUB_REPOSITORY, sha, version,
    directory: path.join(root, 'dist/release') });
};
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { publish };
