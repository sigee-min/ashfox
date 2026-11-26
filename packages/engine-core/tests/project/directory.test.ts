import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  compileDirectoryWorkspace,
  readDirectoryWorkspace,
  isDirectorySource,
  compileSpriteDocument,
  parseSpriteSource,
} from '../../src';

const directory = path.resolve(__dirname, '../../../../examples/items');
const configSource = fs.readFileSync(path.join(directory, '.ashfoxworkspace'), 'utf8');
const loadAshfox = (dir: string, prefix: string): { path: string; source: string }[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? loadAshfox(path.join(dir, e.name), `${prefix}/${e.name}`)
      : e.name.endsWith('.ashfox')
        ? [
            {
              path: `${prefix}/${e.name}`,
              source: fs.readFileSync(path.join(dir, e.name), 'utf8'),
            },
          ]
        : [],
  );
const files = loadAshfox(path.join(directory, 'assets'), 'assets');
const config = readDirectoryWorkspace(configSource);
assert.equal(config.version, 2);
assert.ok(isDirectorySource(config, 'assets/sprites/apple.ashfox'));
assert.ok(!isDirectorySource(config, 'assets/drafts/apple.ashfox'));
assert.ok(!isDirectorySource(config, 'build/apple.ashfox'));
assert.ok(!isDirectorySource(config, 'exports/apple/apple.ashfox'));

const compiled = compileDirectoryWorkspace(configSource, files);
assert.ok(compiled.ok, JSON.stringify(compiled));
if (!compiled.ok) throw new Error('Expected directory compilation');
assert.equal(compiled.products.length, 12);
const appleProduct = compiled.products.find((x) => x.entry.entryName === 'apple')!;
assert.equal(appleProduct.kind, 'sprite');

const sharedSource = `ashfox-model 1
module shared {
  export material red_skin { ramp { mode = auto; base = #c94040; preset = organic; } }
  export material leaf { ramp { mode = auto; base = #509a44; preset = organic; } }
  export stamp stem { rows = ["ss", ".s"]; slots = ["s"]; }
}`;

const appleSource = `ashfox-model 1
sprite apple {
  import "../module/shared.ashfox" as shared;
  profile = item;
  canvas = (32px, 32px);
  palette {
    bark = #734b34;
    glint = #fff5e6;
  }
  shape body {
    shape { kind = ellipse; cx = 16; cy = 18; rx = 9; ry = 8; }
    material = shared.red_skin;
    shade { form = round; light = top_left; contrast = 2; specular = 1; }
    grain { mode = soft; amount = 1; seed = 23; }
  }
  stamp stem_top { stamp = shared.stem; at = (15px, 7px); flip = none; colors { s = bark; } }
  paint shine { at = (11px, 13px); rows = ["gg", "g."]; colors { g = glint; } }
  outline rim { mode = sel_out; strength = 2; innerRim = true; }
}`;

const parityConfig = JSON.stringify({
  format: 'ashfox-workspace',
  version: 2,
  name: 'sprite-parity',
  packages: [
    {
      name: 'items',
      root: 'assets/sprites',
      manifest: {
        format: 'ashfox-package',
        version: 1,
        dependencies: [],
        entries: [{ name: 'apple', path: 'apple.ashfox' }],
        modules: [],
      },
    },
    {
      name: 'shared_modules',
      root: 'assets/module',
      manifest: {
        format: 'ashfox-package',
        version: 1,
        dependencies: [],
        entries: [],
        modules: [{ subpath: './shared', path: 'shared.ashfox' }],
      },
    },
  ],
  include: ['assets/**/*.ashfox'],
  ignore: ['assets/drafts/**'],
  build: { directory: 'build' },
  exports: [
    {
      name: 'apple',
      entry: { packageName: 'items', entryName: 'apple' },
      format: 'png',
      directory: 'exports/apple',
    },
  ],
});

const parityCompiled = compileDirectoryWorkspace(parityConfig, [
  { path: 'assets/sprites/apple.ashfox', source: appleSource },
  { path: 'assets/module/shared.ashfox', source: sharedSource },
]);
assert.ok(parityCompiled.ok, JSON.stringify(parityCompiled));
if (parityCompiled.ok && parityCompiled.products[0]!.kind === 'sprite') {
  const standalone = compileSpriteDocument({
    masks: [],
    materials: [
      { id: 'red_skin', ramp: { mode: 'auto', base: '#c94040', preset: 'organic' } },
      { id: 'leaf', ramp: { mode: 'auto', base: '#509a44', preset: 'organic' } },
    ],
    stamps: [{ id: 'stem', rows: ['ss', '.s'], slots: ['s'] }],
    item: {
      ...parseSpriteSource(appleSource, 'apple.ashfox').item!,
      layers: [
        {
          id: 'body',
          op: 'shape',
          shape: { kind: 'ellipse', cx: 16, cy: 18, rx: 9, ry: 8 },
          material: 'red_skin',
          shade: { form: 'round', light: 'top_left', contrast: 2, specular: 1 },
          grain: { mode: 'soft', amount: 1, seed: 23 },
        },
        {
          id: 'stem_top',
          op: 'stamp',
          stamp: 'stem',
          at: [15, 7],
          flip: 'none',
          colors: { s: 'bark' },
        },
        { id: 'shine', op: 'paint', at: [11, 13], rows: ['gg', 'g.'], colors: { g: 'glint' } },
        { id: 'rim', op: 'outline', mode: 'sel_out', strength: 2, innerRim: true },
      ],
    },
  });
  assert.ok(standalone.ok);
  if (standalone.ok)
    assert.deepEqual(parityCompiled.products[0]!.sprite.png, standalone.products[0]!.png);
}

const repeat = compileDirectoryWorkspace(configSource, [...files].reverse());
assert.ok(repeat.ok);
if (repeat.ok) assert.equal(repeat.buildKey, compiled.buildKey);
assert.equal(compileDirectoryWorkspace(configSource, files.slice(1)).ok, false);
assert.equal(
  compileDirectoryWorkspace(configSource, [
    ...files,
    { path: 'assets/sprites/extra.ashfox', source: files[0]!.source },
  ]).ok,
  false,
);
const changed = JSON.parse(configSource);
changed.ignore = ['assets/sprites/apple.ashfox'];
assert.throws(() => readDirectoryWorkspace(JSON.stringify(changed)), /included/);
changed.ignore = [];
changed.build.directory = '../outside';
assert.throws(() => readDirectoryWorkspace(JSON.stringify(changed)), /directory/);
changed.build.directory = 'exports';
assert.throws(() => readDirectoryWorkspace(JSON.stringify(changed)), /disjoint/);
changed.build.directory = '.ashfoxworkspace';
assert.throws(() => readDirectoryWorkspace(JSON.stringify(changed)), /disjoint/);
changed.build.directory = 'build';
changed.exports[0].format = 'glb';
assert.equal(compileDirectoryWorkspace(JSON.stringify(changed), files).ok, false);
assert.throws(
  () => readDirectoryWorkspace(configSource.replace('"version": 2', '"version": 2, "version": 2')),
  /unique keys/,
);
assert.throws(
  () => readDirectoryWorkspace(configSource.replace('"version": 2', '"version": 1')),
  /version 2/,
);
const apple = files.find((f) => f.path === 'assets/sprites/apple.ashfox')!;
const invalid = files.map((f) =>
  f === apple
    ? { ...f, source: f.source.replace('../module/shared.ashfox', '../../outside.ashfox') }
    : f,
);
assert.equal(compileDirectoryWorkspace(configSource, invalid).ok, false);
assert.throws(() => parseSpriteSource('\uFEFF' + apple.source, apple.path), /BOM/);
assert.throws(() => parseSpriteSource(apple.source + '\uD800', apple.path), /surrogate/);
const badUnit = appleSource.replace('seed = 23;', 'seed = 23px;');
assert.throws(() => parseSpriteSource(badUnit, apple.path), /unitless/);
assert.throws(
  () => parseSpriteSource(JSON.stringify({ id: 'apple' }), 'apple.ashfox'),
  /ashfox-model/,
);

const cyclic = files.map((f) =>
  f.path === 'assets/module/shared.ashfox'
    ? {
        ...f,
        source: f.source.replace(
          'module shared {',
          'module shared { import "./shared.ashfox" as loop;',
        ),
      }
    : f,
);
assert.equal(compileDirectoryWorkspace(configSource, cyclic).ok, false);

// Mixed model + sprite workspace compiles together.
const foxWs = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../../../assets/workspaces/fox.ashfoxworkspace'),
    'utf8',
  ),
);
const modelFiles = (foxWs.files as { path: string; source: string }[]).map((f) => ({
  ...f,
  path: `assets/models/${f.path}`,
}));
const modelPackages = foxWs.manifest.packages.map(
  (p: { root: string; manifest: unknown; name: string }) => ({
    ...p,
    root: `assets/models/${p.root}`,
  }),
);
const mixed = {
  ...config,
  packages: [...config.packages, ...modelPackages],
  include: ['assets/**/*.ashfox'],
  exports: [
    ...config.exports,
    {
      name: 'fox_model',
      entry: { packageName: 'creatures', entryName: 'fox' },
      format: 'glb',
      directory: 'exports/fox',
    },
  ],
};
const mixedResult = compileDirectoryWorkspace(JSON.stringify(mixed), [...files, ...modelFiles]);
assert.ok(mixedResult.ok, JSON.stringify(mixedResult));
if (mixedResult.ok) {
  assert.equal(mixedResult.products.length, 13);
  assert.equal(mixedResult.products.filter((x) => x.kind === 'model').length, 1);
}
console.log(
  'directory workspace: Sprite v2 parity, mixed model/sprite, root exclusions and fail-closed contracts ok',
);

const unexported = structuredClone(mixed);
const modelPackage = unexported.packages.find((p) => p.name === 'creatures')!;
modelPackage.manifest.entries.push({ name: 'broken', path: 'broken.ashfox' });
assert.equal(
  compileDirectoryWorkspace(JSON.stringify(unexported), [
    ...files,
    ...modelFiles,
    { path: 'assets/models/creatures/broken.ashfox', source: 'ashfox-model 1\nasset broken {}' },
  ]).ok,
  false,
  'Collecting compiled products must still reject an invalid entry with no export.',
);
const orphaned = structuredClone(mixed);
orphaned.packages
  .find((p) => p.name === 'creatures')!
  .manifest.modules.push({ subpath: './orphan', path: 'orphan.ashfox' });
assert.equal(
  compileDirectoryWorkspace(JSON.stringify(orphaned), [
    ...files,
    ...modelFiles,
    { path: 'assets/models/creatures/orphan.ashfox', source: 'ashfox-model 1\nmodule orphan {}' },
  ]).ok,
  false,
  'Reusing compilation must still reject unreachable declared modules.',
);
