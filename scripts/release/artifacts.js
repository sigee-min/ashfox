'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { sha256 } = require('../shared');
const root = path.resolve(__dirname, '../..');
const names = ['ashfox-cli.tgz', 'starter.zip'];
const verify = (directory) => {
  const expected = names
    .map((name) => `${sha256(fs.readFileSync(path.join(directory, name)))}  ${name}\n`)
    .join('');
  if (fs.readFileSync(path.join(directory, 'SHA256SUMS'), 'utf8') !== expected) {
    throw new Error('Release checksum mismatch');
  }
};
if (require.main === module) {
  const out = path.join(root, 'dist/release');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  for (const name of names)
    fs.copyFileSync(path.join(root, 'dist', 'docs-delivery', name), path.join(out, name));
  fs.writeFileSync(
    path.join(out, 'SHA256SUMS'),
    names.map((name) => `${sha256(fs.readFileSync(path.join(out, name)))}  ${name}\n`).join(''),
  );
  verify(out);
}
module.exports = { names, hash: sha256, verify };
