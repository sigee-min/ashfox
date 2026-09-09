import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { compileItemStudy, readItemStudy } from '../../src/index';
import { baseTone, grainDelta, materialRamp } from '../../src/compiler/sprite/shade';

const source = fs.readFileSync(path.resolve(__dirname, '../../../../packages/engine-core/tests/fixtures/items.json'), 'utf8');
const build = (text = source) => {
  const result = compileItemStudy(text);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result;
};
const original = build();
assert.equal(original.products.length, 10);
assert.deepEqual(original.products.map(p => p.png), build().products.map(p => p.png));
const change = (fn: (value: Record<string, unknown>) => void): string => {
  const v = JSON.parse(source) as Record<string, unknown>; fn(v); return JSON.stringify(v);
};
assert.equal(compileItemStudy(source.replace('"version": 1', '"version": 1, "version": 1')).ok, false);
assert.equal(compileItemStudy(source.replace('"version": 1', '"version": 1, "\\u0076ersion": 1')).ok, false);
assert.equal(compileItemStudy(change(v => { v.extra = true; })).ok, false);
assert.equal(compileItemStudy('['.repeat(18) + '0' + ']'.repeat(18)).ok, false);
const study = readItemStudy(source);
assert.ok(Object.isFrozen(study.items[0]!.layers));
for (const product of original.products) {
  const png = Buffer.from(product.png);
  assert.equal(png.readUInt32BE(16), 16); assert.equal(png.readUInt32BE(20), 16);
  let offset = 8; const chunks: Buffer[] = [];
  while (offset < png.length) {
    const len = png.readUInt32BE(offset), kind = png.toString('ascii', offset + 4, offset + 8);
    if (kind === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + len));
    offset += len + 12;
  }
  const scan = inflateSync(Buffer.concat(chunks));
  const rgba = Buffer.concat(Array.from({ length: 16 }, (_, y) => {
    assert.equal(scan[y * 65], 0); return scan.subarray(y * 65 + 1, y * 65 + 65);
  }));
  assert.deepEqual(rgba, Buffer.from(product.raster.rgba.copy()));
  for (let i = 0; i < 256; i++) if (rgba[i * 4 + 3] === 0) assert.deepEqual([...rgba.subarray(i * 4, i * 4 + 4)], [0, 0, 0, 0]);
}
const round = { form: 'round' as const, light: 'top_left', contrast: 2 };
assert.ok(baseTone(round, 0, 0, 5, 5) >= 3);
assert.equal(baseTone(round, 4, 4, 5, 5), 0);
assert.equal(baseTone({ ...round, light: 'bottom_right' }, 0, 0, 5, 5), 0);
assert.equal(baseTone({ ...round, contrast: 0 }, 0, 0, 5, 5), 2);
assert.equal(baseTone({ ...round, form: 'bevel', axis: [[0, 4], [4, 0]] }, 0, 0, 5, 5), 4);
assert.equal(grainDelta(0, 0, 23), grainDelta(1, 1, 23));
assert.deepEqual(materialRamp({ id: 'test', ramp: { mode: 'explicit', colors: ['#000000', '#808080', '#FFFFFF'] } }),
  ['#000000', '#404040', '#808080', '#c0c0c0', '#FFFFFF']);
assert.equal(materialRamp({ id: 'test', ramp: { mode: 'generated', base: '#808080', preset: 'neutral-v1' } }).length, 5);
const fixture = {
  format: 'ashfox-item-study', version: 1,
  masks: [{ id: 'shape', rows: ['11111', '11111', '11111', '11111', '11111'] }],
  materials: [{ id: 'metal', ramp: { mode: 'explicit', colors: ['#102030', '#708090', '#E0F0FF'] } }], stamps: [],
  items: [{ id: 'test', profile: 'minecraft-item-v1', canvas: [16, 16], palette: { shine: '#FEDCBA' },
    layers: [{ id: 'body', op: 'part', mask: 'shape', material: 'metal', at: [1, 1], shade: round,
      grain: { mode: 'clustered-v1', amount: 1, seed: 23 },
      patches: [{ id: 'shine', at: [2, 2], rows: ['h'], colors: { h: 'shine' }, protect: 1 }] }] }]
};
const run = () => build(JSON.stringify(fixture)).products[0]!;
const before = run(), layer = fixture.items[0]!.layers[0]!;
layer.shade.light = 'bottom_right'; assert.equal(compileItemStudy(JSON.stringify(fixture)).ok, false);
layer.shade.light = 'top_left';
const savedColors = fixture.materials[0]!.ramp.colors;
fixture.materials[0]!.ramp.colors = ['#FFFFFF','#808080','#000000'];
assert.equal(compileItemStudy(JSON.stringify(fixture)).ok, false);
fixture.materials[0]!.ramp.colors = savedColors;
assert.deepEqual([...before.raster.rgba.copy().slice((3 * 16 + 3) * 4, (3 * 16 + 3) * 4 + 4)], [254, 220, 186, 255]);
assert.ok(before.evidence.filter(e => e?.protected).every(e => e?.grainDelta === 0));
layer.grain.seed = 91;
assert.deepEqual(before.evidence.map(e => e?.baseTone), run().evidence.map(e => e?.baseTone));
layer.grain.seed = 23;
fixture.materials[0]!.ramp.colors = ['#112200', '#667722', '#AABB44'];
assert.deepEqual(before.evidence.map(e => [e?.baseTone, e?.grainDelta]), run().evidence.map(e => [e?.baseTone, e?.grainDelta]));
const beforeRename = run(); layer.id = 'renamed'; assert.deepEqual(beforeRename.png, run().png);
const renamed = run();
layer.at = [6, 5];
const moved = run();
for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
  const a = (y + 1) * 16 + x + 1, b = (y + 5) * 16 + x + 6;
  assert.deepEqual([...renamed.raster.rgba.copy().slice(a * 4, a * 4 + 4)], [...moved.raster.rgba.copy().slice(b * 4, b * 4 + 4)]);
}
layer.at = [15, 15]; assert.equal(compileItemStudy(JSON.stringify(fixture)).ok, false);
layer.at = [1, 1]; fixture.masks[0]!.rows[2] = '11.11';
assert.equal(compileItemStudy(JSON.stringify(fixture)).ok, false);
// Unrelated entry affects the source head, not an existing product or build key.
const subset = JSON.parse(source); subset.items = subset.items.slice(0, 1);
const one = build(JSON.stringify(subset));
assert.notEqual(one.sourceHash, original.sourceHash);
assert.equal(one.products[0]!.receipt.buildKey, original.products.find(p => p.id === one.products[0]!.id)!.receipt.buildKey);
const pixels = { format: 'ashfox-item-study', version: 1, masks: [], materials: [],
  stamps: [{ id: 'mark', rows: ['ab'], slots: ['a', 'b'] }],
  items: [{ id: 'pixels', profile: 'minecraft-item-v1', canvas: [16, 16], palette: { red: '#FF0000', green: '#00FF00' },
    layers: [
      { id: 'stamp', op: 'stamp', stamp: 'mark', at: [0, 0], flip: 'x', colors: { a: 'red', b: 'green' } },
      { id: 'erase', op: 'erase', at: [1, 0], rows: ['1'] },
      { id: 'paint', op: 'paint', at: [1, 0], rows: ['g'], colors: { g: 'green' } }
    ] }] };
assert.deepEqual([...build(JSON.stringify(pixels)).products[0]!.raster.rgba.copy().slice(0, 8)], [0, 255, 0, 255, 0, 255, 0, 255]);
pixels.items[0]!.layers.splice(1); pixels.items[0]!.layers[0]!.colors!.a = 'missing';
assert.equal(compileItemStudy(JSON.stringify(pixels)).ok, false);
console.log('sprite compiler: deterministic pixels, shading, contracts, independent PNG decoding ok');
