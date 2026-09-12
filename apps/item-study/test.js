'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildWorkspace } = require('./native');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-item-studio-'));
const project = path.join(temporary, 'source');
const output = path.join(temporary, 'previews');
try {
  fs.cpSync(path.resolve(__dirname, '../../examples/items'), project, {
    recursive: true,
    filter: (file) => !file.split(path.sep).includes('dist')
  });
  const input = path.join(project, '.ashfoxworkspace');
  const original = fs.readFileSync(path.join(project, 'src/iron_sword.ashfox'));
  const first = buildWorkspace(input, output);
  const second = buildWorkspace(input, output);
  assert.equal(first.sourceHash, second.sourceHash);
  assert.equal(first.key, second.key);
  assert.notEqual(first.directory, second.directory, 'previews are isolated snapshots');
  const receipt = JSON.parse(fs.readFileSync(path.join(first.directory, 'receipt.json'), 'utf8'));
  assert.ok(receipt.items.length > 0, 'native workspace produces actual sprites');
  for (const file of fs.readdirSync(first.directory)) {
    assert.deepEqual(fs.readFileSync(path.join(first.directory, file)),
      fs.readFileSync(path.join(second.directory, file)), file);
  }
  const png = fs.readFileSync(path.join(first.directory, 'iron_sword.png'));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 16);
  assert.equal(png.readUInt32BE(20), 16);
  assert.deepEqual(fs.readFileSync(path.join(project, 'src/iron_sword.ashfox')), original);
  const snapshots = fs.readdirSync(output);
  fs.writeFileSync(path.join(project, 'src/iron_sword.ashfox'), 'invalid native source');
  assert.throws(() => buildWorkspace(input, output));
  assert.deepEqual(fs.readdirSync(output), snapshots, 'failed input cannot publish a preview');
  assert.deepEqual(fs.readFileSync(path.join(first.directory, 'iron_sword.png')), png);
  fs.writeFileSync(path.join(project, 'src/iron_sword.ashfox'), original);
  const blocked = path.join(temporary, 'blocked');
  fs.writeFileSync(blocked, 'user file');
  assert.throws(() => buildWorkspace(input, blocked));
  assert.equal(fs.readFileSync(blocked, 'utf8'), 'user file');
  console.log('Native item studio: deterministic snapshots, source preservation and failed-build isolation passed');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
