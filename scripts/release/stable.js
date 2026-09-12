'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { isStrictSemVer } = require('./validate');
const { instructions } = require('./instructions');
const root = path.resolve(__dirname, '../..');
const readStable = (directory = root) => {
  const record = JSON.parse(fs.readFileSync(path.join(directory, 'scripts/release/stable.json'), 'utf8'));
  if (!record || Object.keys(record).join() !== 'version' || !isStrictSemVer(record.version) || /[-+]/.test(record.version)) {
    throw new Error('Stable release must contain one stable SemVer version');
  }
  const base = `https://github.com/sigee-min/ashfox/releases/download/v${record.version}/`;
  const onboarding = true;
  return { version: record.version, cli: base + 'ashfox-cli.tgz', starter: base + 'starter.zip', onboarding, grouped: record.version !== '1.0.0' };
};
const files = {
  'docs/guides/install.md': ['install', 'check', 'start', 'offline', 'availability'],
  'docs/guides/cli.md': ['availability']
};
const sync = (check = false, directory = root, stable = readStable(directory)) => {
  const copy = instructions(stable);
  // Validate every block before writing any document, including during promotion.
  const updates = Object.entries(files).map(([file, blocks]) => {
    const target = path.join(directory, file);
    const source = fs.readFileSync(target, 'utf8');
    let updated = source.replace(/https:\/\/github\.com\/sigee-min\/ashfox\/releases\/download\/v[^/\s]+\/(ashfox-cli\.tgz|starter\.zip)/g,
      (_url, name) => name === 'starter.zip' ? stable.starter : stable.cli);
    for (const name of blocks) {
      const begin = `<!-- ashfox:${name} -->`, end = `<!-- ashfox:${name}-end -->`;
      if (updated.split(begin).length !== 2 || updated.split(end).length !== 2 || updated.indexOf(begin) > updated.indexOf(end)) {
        throw new Error(`Missing or duplicate release block ${name}: ${file}`);
      }
      updated = updated.slice(0, updated.indexOf(begin)) + `${begin}\n${copy[name]}\n${end}` +
        updated.slice(updated.indexOf(end) + end.length);
    }
    if (check && updated !== source) throw new Error(`Stale release instructions: ${file}`);
    return { target, source, updated };
  });
  if (!check) for (const { target, source, updated } of updates) {
    if (updated !== source) fs.writeFileSync(target, updated);
  }
};
if (require.main === module) sync(process.argv.includes('--check'));
module.exports = { readStable, sync };
