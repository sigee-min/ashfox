import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readDirectoryWorkspace, isDirectorySource } from '../../src';
const file = path.resolve(__dirname, '../../../../examples/resource-pack/.ashfoxworkspace');
const original = JSON.parse(fs.readFileSync(file, 'utf8'));
const accepted = readDirectoryWorkspace(JSON.stringify(original));
const javaPack = accepted.packs?.[0];
assert.ok(javaPack?.format === 'minecraft_java');
if (javaPack?.format !== 'minecraft_java') throw new Error('Expected Java pack');
assert.equal(javaPack.metadata.format, 'range');
assert.equal(isDirectorySource(accepted, 'dist/pack/accidental.ashfox'), false);
assert.ok(Object.isFrozen(javaPack.sounds));
for (const [field, value] of Object.entries({
  name: 'iron_sword', directory: 'dist/items/pack', format: 'bedrock', unknown: true,
  models: ['iron_sword'], icon: 'claw_hit', itemDefinitions: 'guess', archive: 'yes', minecraftVersion: ''
})) {
  const config = structuredClone(original); config.packs[0][field] = value;
  assert.throws(() => readDirectoryWorkspace(JSON.stringify(config)), Error, field);
}
for (const metadata of [
  { format: 'range', description: 'test', minFormat: [89, 0], maxFormat: [88, 0] },
  { format: 'range', description: 'test', minFormat: [-1, 0], maxFormat: [88, 0] },
  { format: 'legacy', description: 'test', packFormat: 1.5 }
]) {
  const config = structuredClone(original); config.packs[0].metadata = metadata;
  assert.throws(() => readDirectoryWorkspace(JSON.stringify(config)));
}
for (const [field, value] of Object.entries({ source: 'marker', id: 'demo:../escape', volume: 2, pitch: 0,
  variants: [], replace: 'true', extra: false })) {
  const config = structuredClone(original); config.packs[0].sounds[0][field] = value;
  assert.throws(() => readDirectoryWorkspace(JSON.stringify(config)), Error, field);
}
const duplicate = structuredClone(original); duplicate.packs[0].items.push(duplicate.packs[0].items[0]);
assert.throws(() => readDirectoryWorkspace(JSON.stringify(duplicate)));
const legacy = structuredClone(original);
legacy.packs[0].metadata = { format: 'legacy', description: 'legacy project', packFormat: 34 };
legacy.packs[0].itemDefinitions = 'legacy'; legacy.packs[0].minecraftVersion = 'project-selected-version';
const oldPack = readDirectoryWorkspace(JSON.stringify(legacy)).packs?.[0];
assert.ok(oldPack?.format === 'minecraft_java' && oldPack.metadata.format === 'legacy');
console.log('pack declarations: closed fields, references, formats, safe resources, output ownership and configurable profiles ok');
const game = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../examples/game-assets/.ashfoxworkspace'), 'utf8'));
assert.equal(readDirectoryWorkspace(JSON.stringify(game)).packs?.[0]?.format, 'game_assets');
for (const [field, value] of Object.entries({ unitsPerMeter: 0, pixelsPerUnit: -1, spriteFilter: 'guess', audio: 'mp3', assets: [], minecraftVersion: 'extra' })) {
  const changed = structuredClone(game); changed.packs[0][field] = value;
  assert.throws(() => readDirectoryWorkspace(JSON.stringify(changed)), Error, field);
}
for (const [field, value] of Object.entries({ source: 'missing', path: '../escape', id: 'Bad ID', extra: true })) {
  const changed = structuredClone(game); changed.packs[0].assets[0][field] = value;
  assert.throws(() => readDirectoryWorkspace(JSON.stringify(changed)), Error, field);
}
const invalidEncoding = structuredClone(game); invalidEncoding.exports[0].encoding = 'unknown';
assert.throws(() => readDirectoryWorkspace(JSON.stringify(invalidEncoding)));
