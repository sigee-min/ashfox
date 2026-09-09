'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const names = ['ashfox.js', 'ashfox.js.map', 'ashfox-sidecar.js', 'ashfox-sidecar.js.map', 'ashfox-cli.tgz', 'starter.zip'];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const verify = directory => {
  const expected = names.map(name => `${hash(fs.readFileSync(path.join(directory, name)))}  ${name}\n`).join('');
  if (fs.readFileSync(path.join(directory, 'SHA256SUMS'), 'utf8') !== expected) {
    throw new Error('Release checksum mismatch');
  }
};
if (require.main === module) {
  const out = path.join(root, 'dist/release');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  for (const name of names) fs.copyFileSync(path.join(root, 'dist',
    ['ashfox-cli.tgz', 'starter.zip'].includes(name) ? 'docs-delivery' : '', name), path.join(out, name));
  fs.writeFileSync(path.join(out, 'SHA256SUMS'), names.map(name =>
    `${hash(fs.readFileSync(path.join(out, name)))}  ${name}\n`).join(''));
  verify(out);
}
module.exports = { names, hash, verify };
