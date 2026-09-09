'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const h = require('./harness');
require('../../packages/engine-core/tests/program/sprite.test.ts');
async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-items-test-'));
  const source = fs.readFileSync(path.resolve(__dirname, '../../packages/engine-core/tests/fixtures/items.json'), 'utf8');
  try {
    const first = h.propose(source, null, root), stale = h.propose(source, null, root);
    await h.build(first.id, root);
    assert.equal(h.present(first.id, root).receipt.items.length, 10);
    const head = h.apply(first.id, root);
    assert.throws(() => h.propose(source, null, root), /Stale/);
    await h.build(stale.id, root); assert.throws(() => h.apply(stale.id, root), /Stale/);
    const bad = h.propose('{}', head.token, root);
    assert.equal((await h.build(bad.id, root)).status, 'failed');
    assert.equal(h.inspect(root).head.token, head.token);
    const cancel = h.propose(source, head.token, root);
    const running = h.build(cancel.id, root); h.cancel(cancel.id, root);
    assert.equal((await running).status, 'cancelled');
    assert.throws(() => h.apply(cancel.id, root), /built/);
    assert.equal(h.inspect(root).head.token, head.token);
    const delivery = path.join(root, 'delivery'); h.exportHead(delivery, root);
    assert.ok(fs.existsSync(path.join(delivery, 'apple.png')));
    assert.throws(() => h.exportHead(delivery, root));
    const png = path.join(head.directory, 'apple.png'); fs.appendFileSync(png, 'broken');
    assert.throws(() => h.exportHead(path.join(root, 'bad-delivery'), root), /hash mismatch/);
    assert.equal(h.inspect(root).head.token, head.token);
    const exceptionRoot = path.join(root, 'exception');
    const broken = h.propose(source, null, exceptionRoot);
    fs.writeFileSync(path.join(exceptionRoot, 'builds'), 'not a directory');
    assert.equal((await h.build(broken.id, exceptionRoot)).status, 'failed');
    assert.equal(h.inspect(exceptionRoot).head, null);
    console.log('item harness: success, stale head, failed input, running cancellation, verified export ok');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
