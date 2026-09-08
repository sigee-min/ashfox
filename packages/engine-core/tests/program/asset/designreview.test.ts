import assert from 'node:assert/strict';
import { compileAssetWorkspaceEntry } from '../../../src';
import { VALID_ASSET_SOURCE, validAssetWorkspace } from './fixture';

const compile = (source: string) => compileAssetWorkspaceEntry(validAssetWorkspace(source),
  { packageName: 'wolf', entryName: 'wolf' });
const add = (design: string, expression = '(4u, 4u, 4u)') => VALID_ASSET_SOURCE
  .replace('asset wolf {', `asset wolf { ${design}`)
  .replace('size = (4u, 4u, 4u);', `size = ${expression};`);
for (const expression of ['D.size.x.x', 'D.size.nope', 'D.size.x.nope', 'D..size', 'D.size.']) {
  const result = compile(add('design D { size: vec3<unit> = (4u, 4u, 4u); }',
    `(${expression}, 4u, 4u)`));
  assert.equal(result.ok, false, expression);
}
// Axis-named namespaces/fields must remain nominal design references.
const axes = compile(add('design x { y: vec3<unit> = (4u, 4u, 4u); }', '(x.y.x, x.y.y, x.y.z)'));
assert.ok(axes.ok, axes.ok ? '' : JSON.stringify(axes.diagnostics));
const local = compile(VALID_ASSET_SOURCE
  .replace('component Body {', 'component Body { param dimensions: vec3<unit>;')
  .replace('size = (4u, 4u, 4u);', 'size = (dimensions.x, dimensions.y, dimensions.z);')
  .replace('use Body as body {', 'use Body as body { set dimensions = (4u, 4u, 4u);'));
assert.ok(local.ok, local.ok ? '' : JSON.stringify(local.diagnostics));
const shadowed = compile(add('design dimensions { x: unit = 8u; }')
  .replace('component Body {', 'component Body { param dimensions: vec3<unit>;')
  .replace('use Body as body {', 'use Body as body { set dimensions = (4u, 4u, 4u);'));
assert.equal(shadowed.ok, false);
if (!shadowed.ok) assert.ok(shadowed.diagnostics.some((d) => d.code === 'asset.design-namespace'));
const longChain = Array.from({ length: 130 }, (_, i) =>
  `f${i}: unit = ${i === 129 ? '4u' : `D.f${i + 1}`};`).join('\n');
const bounded = compile(add(`design D { ${longChain} }`));
assert.equal(bounded.ok, false);
if (!bounded.ok) assert.ok(bounded.diagnostics.some((d) => d.code === 'asset.design-limit'));
const booleanLeak = compile(add('design D { enabled: bool = true; }', '(D.enabled, 4u, 4u)'));
assert.equal(booleanLeak.ok, false);
console.log('independent design namespace, malformed reference, local vector and budget checks ok');
