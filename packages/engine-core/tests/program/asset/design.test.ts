import assert from 'node:assert/strict';
import { compileAssetWorkspaceEntry } from '../../../src';
import { parseAssetSource } from '../../../src/project/program/asset/parse';
import { computePackageInterfaceHash, withWorkspaceLimits,
  type AuthoredAssetWorkspace } from '../../../src/project/workspace';
import { makeIndexes, parseWorkspaceSources } from '../../../src/project/workspace/graphSource';
import { workspaceFixture } from '../../project/workspace/fixtures';
import { VALID_ASSET_SOURCE, validAssetWorkspace } from './fixture';

const selector = { packageName: 'wolf', entryName: 'wolf' };
const compile = (source: string) => compileAssetWorkspaceEntry(validAssetWorkspace(source), selector);
const design = `export design Dimensions {
  size: vec3<unit> = (Dimensions.edge, Dimensions.edge, Dimensions.edge);
  edge: unit = 8u / 2;
  width: texel = texels(Dimensions.edge * 4, 1);
  height: texel = texels(Dimensions.edge * 2, 1);
  zero: vec3<unit> = (0u, 0u, 0u);
  anchor: vec3<unit> = (2u, 0u, -2u);
  origin: vec3<unit> = mirror_x(Dimensions.anchor, 0u);
  atlasOrigin: vec2<texel> = (Dimensions.width - Dimensions.width, 0px);
  seed: integer = 23;
  check positive = Dimensions.edge > 0u;
}`;
const withDesign = (body: string) => VALID_ASSET_SOURCE.replace('asset wolf {', 'asset wolf {\n' + body);
const source = withDesign(design)
  .replace('origin = (0u, 0u, 0u);', 'origin = Dimensions.zero;')
  .replaceAll('width = 16px;', 'width = Dimensions.width;')
  .replaceAll('height = 8px;', 'height = Dimensions.height;')
  .replace('atlas = (16px, 8px);', 'atlas = (Dimensions.width, Dimensions.height);')
  .replace('origin = (0px, 0px);', 'origin = Dimensions.atlasOrigin;')
  .replace('origin = (-2u, 0u, -2u);', 'origin = Dimensions.origin;')
  .replace('size = (4u, 4u, 4u);', 'size = Dimensions.size;')
  .replace('seed = 23;', 'seed = Dimensions.seed;');

const baseline = compile(VALID_ASSET_SOURCE);
const actual = compile(source);
assert.ok(baseline.ok);
assert.ok(actual.ok, actual.ok ? '' : JSON.stringify(actual.diagnostics));
if (actual.ok && baseline.ok) {
  assert.equal(actual.build.productHash, baseline.build.productHash,
    'shared design values preserve block geometry, pixels and the original mood');
  assert.deepEqual(actual.model, baseline.model);
}

const expectFailure = (body: string, code: string, use = ''): void => {
  const candidate = compile(withDesign(body).replace('size = (4u, 4u, 4u);',
    use === '' ? 'size = (4u, 4u, 4u);' : 'size = ' + use + ';'));
  assert.equal(candidate.ok, false, body);
  if (!candidate.ok) {
    assert.ok(candidate.diagnostics.some((item) => item.code === code), JSON.stringify(candidate.diagnostics));
    assert.ok(candidate.diagnostics.every((item) => item.source?.path === 'wolf/main.ashfox'));
  }
};
expectFailure('design D { a: unit = D.b; b: unit = D.a; }', 'asset.design-cycle');
expectFailure('design D { a: unit = 1u; a: unit = 2u; }', 'asset.design-duplicate-field');
expectFailure('design D { a: unit = 1u; check a = true; }', 'asset.design-duplicate-field');
expectFailure('design D { a: unit = 1px; }', 'asset.value.unit-mismatch');
expectFailure('design D { a: unit = Missing.width; }', 'asset.design-reference');
expectFailure('design D { a: unit = D.missing; }', 'asset.design-reference');
expectFailure('design D { a: unit = 1u; check positive = D.a < 0u; }', 'asset.design-check');
expectFailure('design D { check invalid = 1u; }', 'asset.value.type-mismatch');
expectFailure('design D { a: integer = 4; }', 'asset.value.unit-mismatch', '(D.a, 4u, 4u)');
expectFailure('design D { a: texel = texels(1u / 3, 1); }', 'asset.value.invalid-call');
expectFailure('design D { a: unit = 1u; }', 'asset.design-axis', '(D.a.x, 4u, 4u)');
expectFailure('design D { a: vec2<unit> = (1u, 2u); }', 'asset.design-axis', '(D.a.z, 4u, 4u)');
expectFailure('design Body { a: unit = 1u; }', 'asset.duplicate-symbol');

const axis = compile(withDesign('design D { size: vec3<unit> = (4u, 4u, 4u); x: unit = 4u; }')
  .replace('size = (4u, 4u, 4u);', 'size = (D.size.x, D.x, D.size.z);'));
assert.ok(axis.ok, axis.ok ? '' : JSON.stringify(axis.diagnostics));
if (axis.ok && baseline.ok) assert.equal(axis.build.productHash, baseline.build.productHash);

const parameter = compile(withDesign(design)
  .replace('export component Body {', 'export component Body { param width: unit;')
  .replace('size = (4u, 4u, 4u);', 'size = (width, 4u, 4u);')
  .replace('use Body as body {', 'use Body as body { set width = Dimensions.edge;'));
assert.ok(parameter.ok, parameter.ok ? '' : JSON.stringify(parameter.diagnostics));
if (parameter.ok && baseline.ok) assert.equal(parameter.build.productHash, baseline.build.productHash);
const motion = compile(withDesign(`design Timing {
  duration: second = 1s;
  tilt: vec3<degree> = (5deg, 0deg, 0deg);
}
export motion idle for CreatureRig {
  duration = Timing.duration; fps = 20; loop = loop; rest-relative = true;
  track root.rotation {
    key 0s = (0deg, 0deg, 0deg) linear;
    key Timing.duration = Timing.tilt linear;
  }
}`).replace('skeleton = Wolf;', 'skeleton = Wolf; motion = idle;'));
assert.ok(motion.ok, motion.ok ? '' : JSON.stringify(motion.diagnostics));

const chain = Array.from({ length: 130 }, (_, index) =>
  `v${index}: unit = ${index === 129 ? '1u' : `D.v${index + 1}`};`).join('\n');
expectFailure(`design D { ${chain} }`, 'asset.design-limit');
const shadowed = compile(withDesign(design)
  .replace('export component Body {', 'export component Body { param Dimensions: vec3<unit>;'));
assert.equal(shadowed.ok, false);
if (!shadowed.ok) assert.ok(shadowed.diagnostics.some((item) => item.code === 'asset.design-namespace'));

const imported = (moduleSource: string): AuthoredAssetWorkspace => {
  const workspace = workspaceFixture([
    { path: 'wolf/main.ashfox', source: VALID_ASSET_SOURCE
      .replace('asset wolf {', 'asset wolf { import "./dims.ashfox" as dims;')
      .replace('size = (4u, 4u, 4u);', 'size = (dims.D.edge, dims.D.edge, dims.D.edge);') },
    { path: 'wolf/dims.ashfox', source: moduleSource }
  ], { root: 'wolf', packageName: 'wolf', entries: [{ name: 'wolf', path: 'main.ashfox' }],
    modules: [{ subpath: './dims', path: 'dims.ashfox' }] });
  const states = parseWorkspaceSources(makeIndexes(workspace), [], withWorkspaceLimits(undefined));
  const abi = states?.get('wolf\u0000wolf/dims.ashfox')?.abi;
  assert.ok(abi);
  const pkg = workspace.manifest.packages[0]!;
  return { ...workspace, lock: { ...workspace.lock, packages: [{ ...workspace.lock.packages[0]!,
    interfaceHash: computePackageInterfaceHash(pkg, [{ ...abi, subpath: './dims' }]) }] } };
};
const shared = compileAssetWorkspaceEntry(imported(
  'ashfox-model 1 module dims { export design D { edge: unit = 4u; } }'), selector);
assert.ok(shared.ok, shared.ok ? '' : JSON.stringify(shared.diagnostics));
if (shared.ok && baseline.ok) assert.equal(shared.build.productHash, baseline.build.productHash);
const privateDesign = compileAssetWorkspaceEntry(imported(
  'ashfox-model 1 module dims { design D { edge: unit = 4u; } }'), selector);
assert.equal(privateDesign.ok, false);
if (!privateDesign.ok) assert.ok(privateDesign.diagnostics.some((item) => item.code === 'asset.design-reference'));

const badType = parseAssetSource('ashfox-model 1 module d { design D { width: float = 2; } }', 'd.ashfox');
assert.equal(badType.unit, null);
assert.ok(badType.diagnostics.some((item) => item.code === 'asset.invalid-slot-type'));
console.log('asset design values and checks ok');
