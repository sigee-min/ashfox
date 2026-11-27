import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  compileDirectoryWorkspace,
  compileStructureUnits,
  damerauLevenshtein,
  docsHint,
  suggestClosest,
  suggestUnit,
  toSnakeCaseTrap,
  VfxInputError,
} from '../../src';
import { parseHooksSource } from '../../src/hooks/parse';
import { validateHooksUnit } from '../../src/hooks/validate';
import { parseAssetSource } from '../../src/project/program/asset/parse';
import { parseAshfoxProgram } from '../../src/project/program/syntax/blockParser';
import { parseSpriteSource } from '../../src/project/sprite/source';
import { parseStructureSource } from '../../src/project/structure/parse';
import { parseVfxSource } from '../../src/project/vfx/source';

const singleEntryConfig = (name: string, folder: string, file: string): string =>
  JSON.stringify({
    format: 'ashfox-workspace',
    version: 2,
    name: 'demo',
    packages: [
      {
        name: 'demo',
        root: `assets/${folder}`,
        manifest: {
          format: 'ashfox-package',
          version: 1,
          entries: [{ name, path: file }],
          modules: [],
          dependencies: [],
        },
      },
    ],
    include: ['**/*.ashfox'],
    ignore: [],
    build: { directory: 'dist/build' },
    exports: [],
  });

// 1. Damerau-Levenshtein, maxDistance = 2, alphabetical tie-break, camelCase/kebab-case traps
assert.equal(damerauLevenshtein('abc', 'abc'), 0);
assert.equal(damerauLevenshtein('pos', 'ops'), 1);
assert.equal(damerauLevenshtein('abc', 'cba'), 2);
assert.equal(damerauLevenshtein('ab', 'ba'), 1);
assert.equal(toSnakeCaseTrap('sampleRate'), 'sample_rate');
assert.equal(toSnakeCaseTrap('mirror-x'), 'mirror_x');
assert.equal(suggestClosest('sampleRate', ['duration', 'sample_rate', 'channels']), 'sample_rate');
assert.equal(suggestClosest('mirror-x', ['mirror_x', 'mirror_y']), 'mirror_x');
// Alphabetical tie-break when two candidates tie at distance 1
assert.equal(suggestClosest('cat', ['bat', 'hat']), 'bat');
// Distance > 2 returns null
assert.equal(suggestClosest('completely_wrong', ['fps', 'loop']), null);
// Unit trap suggestion
assert.equal(suggestUnit('seconds'), 's');
assert.equal(suggestUnit('degre'), 'deg');
assert.equal(docsHint('model'), "Hint: run 'ashfox docs model'");

// 2. Program parser & asset compiler: model / rig / motion / surface suggestions + hints
{
  const parsed = parseAshfoxProgram('ashfox 1\nmodle hero {\n}', 'hero.ashfox');
  assert.ok(parsed.diagnostics.length > 0);
  assert.match(parsed.diagnostics[0]!.message, /Did you mean "model"\?/);
  assert.equal(parsed.diagnostics[0]!.hint, "Hint: run 'ashfox docs model'");
}
{
  const parsed = parseAssetSource(
    'ashfox 1\nmodel hero {\n  rig contract hero_rig {\n    joint body {\n      channels = [rotaton];\n    }\n  }\n}\n',
    'hero.ashfox',
  );
  assert.ok(parsed.diagnostics.length > 0);
  assert.ok(parsed.diagnostics.some((d) => /Did you mean "rotation"\?/.test(d.message)));
  assert.ok(parsed.diagnostics.some((d) => d.hint === "Hint: run 'ashfox docs rig'"));
}
{
  const lanternPath = path.resolve(__dirname, '../../../../examples/prop/lantern.ashfox');
  const baseLantern = fs.readFileSync(lanternPath, 'utf8');
  const geomBad = baseLantern.replace('cube base {', 'cube base { miror = true;');
  const geomRes = compileDirectoryWorkspace(
    singleEntryConfig('lantern', 'models', 'lantern.ashfox'),
    [{ path: 'assets/models/lantern.ashfox', source: geomBad }],
  );
  assert.equal(geomRes.ok, false);
  if (!geomRes.ok) {
    const geomDiag = geomRes.diagnostics.find((d) => d.code === 'asset.invalid-geometry-property');
    assert.ok(geomDiag);
    assert.match(geomDiag.message, /Did you mean "mirror"\?/);
    assert.equal(geomDiag.hint, "Hint: run 'ashfox docs model'");
  }

  const motionBad = baseLantern.replace(
    'settings {',
    'motion idle for LanternRig {\n    duration = 1s;\n    fps = 24;\n    loop = looop;\n  }\n  motions = [idle];\n  settings {',
  );
  const motionRes = compileDirectoryWorkspace(
    singleEntryConfig('lantern', 'models', 'lantern.ashfox'),
    [{ path: 'assets/models/lantern.ashfox', source: motionBad }],
  );
  assert.equal(motionRes.ok, false);
  if (!motionRes.ok) {
    const motionDiag = motionRes.diagnostics.find((d) => d.code === 'asset.invalid-motion-loop');
    assert.ok(motionDiag);
    assert.match(motionDiag.message, /Did you mean "loop"\?/);
    assert.equal(motionDiag.hint, "Hint: run 'ashfox docs motion'");
  }

  const surfaceBad = baseLantern.replace(
    'density = 2;',
    'density = 2;\n      render_mode = emssive;',
  );
  const surfaceRes = compileDirectoryWorkspace(
    singleEntryConfig('lantern', 'models', 'lantern.ashfox'),
    [{ path: 'assets/models/lantern.ashfox', source: surfaceBad }],
  );
  assert.equal(surfaceRes.ok, false);
  if (!surfaceRes.ok) {
    const surfDiag = surfaceRes.diagnostics.find(
      (d) => d.code === 'asset.texture.invalid-render-mode',
    );
    assert.ok(surfDiag);
    assert.match(surfDiag.message, /Did you mean "emissive"\?/);
    assert.equal(surfDiag.hint, "Hint: run 'ashfox docs surface'");
  }
}

// 3. Sprite domain suggestions + hint
{
  assert.throws(
    () =>
      parseSpriteSource(
        'ashfox 1\nsprite gem {\n  canvs = [16px, 16px];\n  rect body { from = [0px, 0px]; to = [16px, 16px]; color = #ffffff; }\n}',
        'gem.ashfox',
      ),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /Hint: run 'ashfox docs sprite'/);
      return true;
    },
  );
}

// 4. Structure domain suggestions + hint
{
  assert.throws(
    () =>
      parseStructureSource(
        'ashfox 1\nstructure hut {\n  size = (8b, 6b, 8b);\n  staircase s { style = spirall; at = (2b, 2b); facing = norht; }\n}',
        'hut.ashfox',
      ),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /Did you mean "spiral"\?/);
      assert.match(err.message, /Hint: run 'ashfox docs structure'/);
      return true;
    },
  );
  // Keep compileStructureUnits exercised via direct export check
  assert.equal(typeof compileStructureUnits, 'function');
}

// 5. Hooks domain suggestions + hint
{
  const parsed = parseHooksSource(
    'ashfox 1\nmodel prop {\n  anchor grip : std.grip {\n    facing = norht;\n  }\n}',
    'prop.ashfox',
  );
  assert.ok(parsed.diagnostics.some((d) => /Did you mean "north"\?/.test(d.message)));
  assert.ok(parsed.diagnostics.some((d) => d.hint === "Hint: run 'ashfox docs hooks'"));

  const validParsed = parseHooksSource(
    'ashfox 1\nstructure keep {\n  anchor door : std.door_hinge {\n    facing = north;\n    lockd = true;\n  }\n}',
    'keep.ashfox',
  );
  const validated = validateHooksUnit(validParsed.unit);
  const unknownProp = validated.diagnostics.find((d) => d.code === 'hooks.unknown-property');
  assert.ok(unknownProp);
  assert.match(unknownProp.message, /Did you mean "locked"\?/);
  assert.equal(unknownProp.hint, "Hint: run 'ashfox docs hooks'");
}

// 6. Sound domain suggestions + hint via compileDirectoryWorkspace
{
  const compiled = compileDirectoryWorkspace(singleEntryConfig('beep', 'sounds', 'beep.ashfox'), [
    {
      path: 'assets/sounds/beep.ashfox',
      source:
        'ashfox 1\nsound beep {\n  profile = interface;\n  sampleRate = 48000hz;\n  duration = 0.2s;\n  voice v : osc { pitch = 440hz; }\n  seq s { step hit { voice = v; at = 0s; } }\n}',
    },
  ]);
  assert.equal(compiled.ok, false);
  if (!compiled.ok) {
    assert.match(compiled.diagnostics[0]!.message, /Did you mean "sample_rate"\?/);
    assert.equal(compiled.diagnostics[0]!.hint, "Hint: run 'ashfox docs sound'");
  }
}

// 7. VFX, PR #47 interior, PR #48 motionStmt, and PR #49 primitives/PBR suggestions + hints
{
  assert.throws(
    () =>
      parseVfxSource(
        'ashfox 1\nvfx spark {\n  duration = 0.5;\n  emiter burst {\n    at = 0..0.4;\n  }\n}',
        'spark.ashfox',
      ),
    (err: unknown) => {
      assert.ok(err instanceof VfxInputError);
      assert.match(err.message, /Did you mean "emitter"\?/);
      assert.equal(err.diagnostic.hint, "Hint: run 'ashfox docs vfx'");
      return true;
    },
  );
  assert.throws(
    () =>
      parseVfxSource(
        'ashfox 1\nvfx spark {\n  element slash {\n    color = cor;\n  }\n}',
        'spark.ashfox',
      ),
    (err: unknown) => {
      assert.ok(err instanceof VfxInputError);
      assert.match(err.message, /Did you mean "core"\?/);
      assert.equal(err.diagnostic.hint, "Hint: run 'ashfox docs vfx'");
      return true;
    },
  );
}
{
  assert.throws(
    () =>
      parseStructureSource(
        'ashfox 1\nstructure hall {\n  size = (10b, 6b, 10b);\n  interior main {\n    dna = { arch = rustic; };\n    partiion divider { axis = x; }\n  }\n}',
        'hall.ashfox',
      ),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /Did you mean "partition"\?/);
      assert.match(err.message, /Hint: run 'ashfox docs structure'/);
      return true;
    },
  );
}
{
  const ikBad = parseAssetSource(
    'ashfox 1\nmodel bot {\n  motion walk for BotRig {\n    duration = 1s;\n    fps = 24;\n    loop = loop;\n    ik leg {\n      foot_lok = 0..1;\n    }\n  }\n}',
    'bot.ashfox',
  );
  assert.ok(ikBad.diagnostics.some((d) => /Did you mean "foot_lock"\?/.test(d.message)));
  assert.ok(ikBad.diagnostics.some((d) => d.hint === "Hint: run 'ashfox docs motion'"));
}
{
  const lanternPath = path.resolve(__dirname, '../../../../examples/prop/lantern.ashfox');
  const baseLantern = fs.readFileSync(lanternPath, 'utf8');
  const pbrBad = baseLantern.replace('density = 2;', 'density = 2;\n      roughness = 2;');
  const pbrRes = compileDirectoryWorkspace(
    singleEntryConfig('lantern', 'models', 'lantern.ashfox'),
    [{ path: 'assets/models/lantern.ashfox', source: pbrBad }],
  );
  assert.equal(pbrRes.ok, false);
  if (!pbrRes.ok) {
    const pbrDiag = pbrRes.diagnostics.find((d) => d.code === 'asset.texture.invalid-pbr');
    assert.ok(pbrDiag);
    assert.equal(pbrDiag.hint, "Hint: run 'ashfox docs surface'");
  }
}

process.stdout.write('suggest: fuzzy suggestions, case traps, and domain hints passed\n');
