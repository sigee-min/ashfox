'use strict';

const assert = require('node:assert/strict');
const { register } = require('ts-node');
const { extractAshfoxBlocks, verifyBlocks } = require('./doctest');

register({
  transpileOnly: true,
  compilerOptions: { module: 'CommonJS', moduleResolution: 'Node' },
});
const engine = require('@ashfox/engine-core');

const VALID_SPRITE = [
  'ashfox 1',
  'sprite dot {',
  '  profile = item;',
  '  canvas = (16px, 16px);',
  '  export material gold { ramp { mode = auto; base = #e2ac48; preset = warm; } }',
  '  palette { glint = #ffffff; }',
  '  capsule gem { from = (5px, 8px); to = (11px, 8px); radius = 3px; material = gold; shade { form = round; light = top_left; contrast = 2; } }',
  '  paint sparkle { at = (6px, 6px); rows = ["g"]; colors { g = glint; } }',
  '  outline edge { mode = sel_out; strength = 1; inner_rim = true; }',
  '}',
].join('\n');

const INVALID_SPRITE = ['ashfox 1', 'sprite broken {', '  canvs = (16px, 16px);', '}'].join('\n');

const sampleMarkdown = [
  '# Demo',
  '',
  '```sh',
  'echo "ignored"',
  '```',
  '',
  '```ashfox',
  VALID_SPRITE,
  '```',
  '',
  '```ashfox invalid',
  INVALID_SPRITE,
  '```',
  '',
].join('\n');

const extracted = extractAshfoxBlocks(sampleMarkdown, 'docs/demo.md');
assert.equal(extracted.length, 2);
assert.equal(extracted[0].expectInvalid, false);
assert.equal(extracted[1].expectInvalid, true);
assert.deepEqual(verifyBlocks(extracted, engine, []), []);

const unexpectedPass = extractAshfoxBlocks(
  ['```ashfox invalid', VALID_SPRITE, '```'].join('\n'),
  'docs/bad.md',
);
assert.equal(verifyBlocks(unexpectedPass, engine, []).length, 1);

const unexpectedFail = extractAshfoxBlocks(
  ['```ashfox', INVALID_SPRITE, '```'].join('\n'),
  'docs/fail.md',
);
assert.equal(verifyBlocks(unexpectedFail, engine, []).length, 1);

console.log('ashfox doctest unit tests ok');
