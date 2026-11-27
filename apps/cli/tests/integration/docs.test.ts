'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const matchText = (source: string, pattern: RegExp): RegExpMatchArray => {
  const match = source.match(pattern);
  assert.ok(match, 'Document contains the expected complete example');
  return match;
};
const root = path.resolve(__dirname, '../../../..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-doc-examples-'));
const run = (command: string, input: string) => {
  const child = spawnSync(
    process.execPath,
    [path.join(__dirname, '../../dist/ashfox.cjs'), command, input],
    { encoding: 'utf8', timeout: 120000 },
  );
  assert.equal(child.status, 0, child.stdout + child.stderr);
  return JSON.parse(String(child.stdout)).result;
};
try {
  for (const guide of ['sprites', 'sounds', 'precision-modeling']) {
    const markdown = fs.readFileSync(path.join(root, 'docs/guides', `${guide}.md`), 'utf8');
    const source = [...markdown.matchAll(/```(?:ashfox|text)\n(ashfox 1\n[\s\S]*?)```/g)][0]?.[1];
    assert.ok(source, `${guide} must provide a complete source`);
    const folder = path.join(temp, guide);
    fs.mkdirSync(folder);
    const entry = path.join(folder, 'example.ashfox');
    fs.writeFileSync(entry, source);
    run('check', entry);
    run('build', entry);
    const id = matchText(source, /(?:sprite|sound|model) (\w+) \{/)[1];
    run('check', path.join(folder, 'dist', id, 'build'));
  }
  for (const file of fs
    .readdirSync(path.join(root, 'docs/language'))
    .filter((name) => name.endsWith('.md'))) {
    const markdown = fs.readFileSync(path.join(root, 'docs/language', file), 'utf8');
    const examples = [...markdown.matchAll(/```ashfox\n([\s\S]*?)```/g)];
    for (const [index, match] of examples.entries()) {
      const folder = path.join(temp, file + '-' + index);
      fs.mkdirSync(folder);
      const entry = path.join(folder, 'example.ashfox');
      fs.writeFileSync(entry, match[1]);
      run('check', entry);
      run('build', entry);
      const id = matchText(match[1], /(?:sprite|sound|model|structure) (\w+) \{/)[1];
      run('check', path.join(folder, 'dist', id, 'build'));
    }
  }
  const markdown = fs.readFileSync(path.join(root, 'docs/guides/workspace.md'), 'utf8');
  const config = JSON.parse(String(matchText(markdown, /```json\n([\s\S]*?)```/)[1]));
  const folder = path.join(temp, 'workspace');
  fs.mkdirSync(path.join(folder, 'assets/sprites'), { recursive: true });
  fs.mkdirSync(path.join(folder, 'assets/module'), { recursive: true });
  fs.writeFileSync(
    path.join(folder, 'assets/module/shared.ashfox'),
    `ashfox 1
module shared {
  export material red_skin { ramp { mode = auto; base = #c94040; preset = organic; } }
  export stamp stem { rows = ["ss", ".s"]; slots = ["s"]; }
}
`,
  );
  fs.writeFileSync(
    path.join(folder, 'assets/sprites/apple.ashfox'),
    `ashfox 1
sprite apple {
  import "../module/shared.ashfox" as shared;
  profile = item;
  canvas = (32px, 32px);
  palette { bark = #734b34; glint = #fff5e6; }
  ellipse body {
    cx = 16px; cy = 18px; rx = 9px; ry = 8px;
    material = shared.red_skin;
    shade { form = round; light = top_left; contrast = 2; specular = 1; }
    grain soft { amount = 1; seed = 23; }
  }
  stamp stem_top { stamp = shared.stem; at = (15px, 7px); flip = none; colors { s = bark; } }
  paint shine { at = (11px, 13px); rows = ["gg", "g."]; colors { g = glint; } }
  outline rim { mode = sel_out; strength = 2; inner_rim = true; }
}
`,
  );
  const entry = path.join(folder, '.ashfoxworkspace');
  fs.writeFileSync(entry, JSON.stringify(config));
  run('check', entry);
  run('build', entry);
  run('check', path.join(folder, 'build'));
  console.log('Published complete source and workspace examples compile, build and verify');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
