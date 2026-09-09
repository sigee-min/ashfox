'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-doc-examples-'));
const run = (command, input) => {
  const child = spawnSync(process.execPath, [path.join(__dirname, 'dist/ashfox.cjs'), command, input], { encoding: 'utf8', timeout: 120000 });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  return JSON.parse(child.stdout).result;
};
try {
  for (const guide of ['sprites', 'sounds', 'precision-modeling']) {
    const markdown = fs.readFileSync(path.join(root, 'docs/guides', `${guide}.md`), 'utf8');
    const source = [...markdown.matchAll(/```(?:ashfox|text)\n(ashfox-model 1\n[\s\S]*?)```/g)][0]?.[1];
    assert.ok(source, `${guide} must provide a complete source`);
    const folder = path.join(temp, guide);
    fs.mkdirSync(folder);
    const entry = path.join(folder, 'example.ashfox');
    fs.writeFileSync(entry, source);
    run('check', entry);
    run('build', entry);
    const id = source.match(/(?:sprite|sound|asset) (\w+) \{/)[1];
    run('verify', path.join(folder, 'dist', id, 'build'));
  }
  const markdown = fs.readFileSync(path.join(root, 'docs/guides/workspace.md'), 'utf8');
  const config = JSON.parse(markdown.match(/```json\n([\s\S]*?)```/)[1]);
  const folder = path.join(temp, 'workspace');
  fs.mkdirSync(path.join(folder, 'src'), { recursive: true });
  for (const name of ['apple', 'shared']) fs.copyFileSync(path.join(root, `examples/items/src/${name}.ashfox`), path.join(folder, `src/${name}.ashfox`));
  const entry = path.join(folder, '.ashfoxworkspace');
  fs.writeFileSync(entry, JSON.stringify(config));
  run('check', entry); run('build', entry); run('verify', path.join(folder, 'build'));
  console.log('Published complete source and workspace examples compile, build and verify');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
