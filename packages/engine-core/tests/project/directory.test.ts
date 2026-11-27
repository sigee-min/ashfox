import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  compileDirectoryWorkspace,
  readDirectoryWorkspace,
  isDirectorySource,
  compileSpriteDocument,
  parseSpriteSource,
  virtualLibrarySpecifierFromPath,
} from '../../src';

const loadStdLibs = (
  dir = path.resolve(__dirname, '../../../../library/std'),
  rel = '',
  out = new Map<string, string>(),
): Map<string, string> => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const next = rel ? `${rel}/${e.name}` : e.name;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) loadStdLibs(full, next, out);
    else if (e.isFile() && e.name.endsWith('.ashfox')) {
      const spec = virtualLibrarySpecifierFromPath(`library/std/${next}`);
      if (spec) out.set(spec, fs.readFileSync(full, 'utf8'));
    }
  }
  return out;
};

const directory = path.resolve(__dirname, '../../../../showcase');
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
assert.ok(isDirectorySource(config, 'assets/sprites/iron_sword.ashfox'));
assert.ok(!isDirectorySource(config, 'assets/drafts/iron_sword.ashfox'));
assert.ok(!isDirectorySource(config, 'build/iron_sword.ashfox'));
assert.ok(!isDirectorySource(config, 'exports/iron_sword/iron_sword.ashfox'));

const stdLibs = loadStdLibs();
const compiled = compileDirectoryWorkspace(configSource, files, stdLibs);
assert.ok(compiled.ok, JSON.stringify(compiled));
if (!compiled.ok) throw new Error('Expected directory compilation');
assert.equal(compiled.products.length, 22);
const swordProduct = compiled.products.find((x) => x.entry.entryName === 'iron_sword')!;
assert.equal(swordProduct.kind, 'sprite');

const sharedSource = `ashfox 1
module shared {
  export material red_skin { ramp { mode = auto; base = #c94040; preset = organic; } }
  export material leaf { ramp { mode = auto; base = #509a44; preset = organic; } }
  export stamp stem { rows = ["ss", ".s"]; slots = ["s"]; }
}`;

const appleSource = `ashfox 1
sprite apple {
  import "../module/shared.ashfox" as shared;
  profile = item;
  canvas = (32px, 32px);
  palette {
    bark = #734b34;
    glint = #fff5e6;
  }
  ellipse body {
    cx = 16px; cy = 18px; rx = 9px; ry = 8px;
    material = shared.red_skin;
    shade { form = round; light = top_left; contrast = 2; specular = 1; }
    grain soft { amount = 1; seed = 23; }
  }
  stamp stem_top { stamp = shared.stem; at = (15px, 7px); flip = none; colors { s = bark; } }
  paint shine { at = (11px, 13px); rows = ["gg", "g."]; colors { g = glint; } }
  outline rim { mode = sel_out; strength = 2; inner_rim = true; }
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
        { id: 'rim', op: 'outline', mode: 'sel_out', strength: 2, inner_rim: true },
      ],
    },
  });
  assert.ok(standalone.ok);
  if (standalone.ok)
    assert.deepEqual(parityCompiled.products[0]!.sprite.png, standalone.products[0]!.png);
}

const repeat = compileDirectoryWorkspace(configSource, [...files].reverse(), stdLibs);
assert.ok(repeat.ok);
if (repeat.ok) assert.equal(repeat.buildKey, compiled.buildKey);
assert.equal(compileDirectoryWorkspace(configSource, files.slice(1), stdLibs).ok, false);
assert.equal(
  compileDirectoryWorkspace(
    configSource,
    [...files, { path: 'assets/sprites/extra.ashfox', source: files[0]!.source }],
    stdLibs,
  ).ok,
  false,
);
const changed = JSON.parse(configSource);
changed.ignore = ['assets/sprites/iron_sword.ashfox'];
assert.throws(() => readDirectoryWorkspace(JSON.stringify(changed)), /included/);
changed.ignore = [];
changed.build.directory = '../outside';
assert.throws(() => readDirectoryWorkspace(JSON.stringify(changed)), /directory/);
changed.build.directory = 'dist/exports';
changed.exports.forEach((e: { directory: string }) => {
  e.directory = 'dist/exports';
});
assert.throws(() => readDirectoryWorkspace(JSON.stringify(changed)), /disjoint/);
changed.build.directory = '.ashfoxworkspace';
assert.throws(() => readDirectoryWorkspace(JSON.stringify(changed)), /disjoint/);
changed.build.directory = 'dist/build';
changed.exports = [{ ...changed.exports[0], format: 'png' }];
changed.packs = [];
assert.equal(compileDirectoryWorkspace(JSON.stringify(changed), files, stdLibs).ok, false);
assert.throws(
  () => readDirectoryWorkspace(configSource.replace('"version": 2', '"version": 2, "version": 2')),
  /unique keys/,
);
assert.throws(
  () => readDirectoryWorkspace(configSource.replace('"version": 2', '"version": 1')),
  /version 2/,
);
const sword = files.find((f) => f.path === 'assets/sprites/iron_sword.ashfox')!;
const invalid = files.map((f) =>
  f === sword
    ? { ...f, source: f.source.replace('"std/sprite/item/weapon"', '"../../outside.ashfox"') }
    : f,
);
assert.equal(compileDirectoryWorkspace(configSource, invalid, stdLibs).ok, false);
assert.throws(() => parseSpriteSource('\uFEFF' + sword.source, sword.path), /BOM/);
assert.throws(() => parseSpriteSource(sword.source + '\uD800', sword.path), /surrogate/);
const badUnit = appleSource.replace('seed = 23;', 'seed = 23px;');
assert.throws(() => parseSpriteSource(badUnit, sword.path), /unitless/);
assert.throws(() => parseSpriteSource(JSON.stringify({ id: 'apple' }), 'apple.ashfox'), /ashfox 1/);

const cyclic = files.map((f) =>
  f.path === 'assets/module/goblin/goblin_kit.ashfox'
    ? {
        ...f,
        source: f.source.replace(
          'module goblin_kit {',
          'module goblin_kit { import "./goblin_kit.ashfox" as loop;',
        ),
      }
    : f,
);
assert.equal(compileDirectoryWorkspace(configSource, cyclic, stdLibs).ok, false);

// Mixed model + sprite workspace compiles together and fails closed on broken/orphaned entries.
assert.equal(compiled.products.length, 22);
assert.equal(compiled.products.filter((x) => x.kind === 'model').length, 7);
assert.equal(compiled.products.filter((x) => x.kind === 'sprite').length, 3);
console.log(
  'directory workspace: Sprite v2 parity, mixed model/sprite, root exclusions and fail-closed contracts ok',
);

const unexported = {
  ...config,
  packages: config.packages.map((p) =>
    p.name === 'models'
      ? {
          ...p,
          manifest: {
            ...p.manifest,
            entries: [...p.manifest.entries, { name: 'broken', path: 'broken.ashfox' }],
          },
        }
      : p,
  ),
};
assert.equal(
  compileDirectoryWorkspace(
    JSON.stringify(unexported),
    [...files, { path: 'assets/models/broken.ashfox', source: 'ashfox 1\nmodel broken {}' }],
    stdLibs,
  ).ok,
  false,
  'Collecting compiled products must still reject an invalid entry with no export.',
);
const orphaned = {
  ...config,
  packages: config.packages.map((p) =>
    p.name === 'models'
      ? {
          ...p,
          manifest: {
            ...p.manifest,
            modules: [...p.manifest.modules, { subpath: './orphan', path: 'orphan.ashfox' }],
          },
        }
      : p,
  ),
};
assert.equal(
  compileDirectoryWorkspace(
    JSON.stringify(orphaned),
    [...files, { path: 'assets/models/orphan.ashfox', source: 'ashfox 1\nmodule orphan {}' }],
    stdLibs,
  ).ok,
  false,
  'Reusing compilation must still reject unreachable declared modules.',
);
