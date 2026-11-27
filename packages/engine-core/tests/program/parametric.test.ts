import assert from 'node:assert/strict';

import {
  compileDirectoryWorkspace,
  parseSpriteSource,
  parseStructureSource,
  parseVfxSource,
  type CubeNode,
  type SceneNode,
} from '../../src';
import { parseAssetSource } from '../../src/project/program/asset/parse';
import { elaborateModelVariants } from '../../src/project/program/asset/variants';
import { parseAshfoxProgram } from '../../src/project/program/syntax/blockParser';

const compileSingleModelWs = (kitSource: string, modelSource: string, entryName = 'hero') => {
  const cfg = JSON.stringify({
    format: 'ashfox-workspace',
    version: 2,
    name: 'parametric_test',
    packages: [
      {
        name: 'test_pkg',
        root: 'assets/models',
        manifest: {
          format: 'ashfox-package',
          version: 1,
          entries: [{ name: entryName, path: `${entryName}.ashfox` }],
          modules: [],
          dependencies: [{ name: 'shared' }],
        },
      },
      {
        name: 'shared',
        root: 'assets/module',
        manifest: {
          format: 'ashfox-package',
          version: 1,
          entries: [],
          modules: [{ subpath: './kit', path: 'kit.ashfox' }],
          dependencies: [],
        },
      },
    ],
    include: ['assets/**/*.ashfox'],
    ignore: [],
    build: { directory: 'dist/build' },
    exports: [],
  });
  return compileDirectoryWorkspace(cfg, [
    { path: 'assets/module/kit.ashfox', source: kitSource },
    { path: `assets/models/${entryName}.ashfox`, source: modelSource },
  ]);
};

const nodeList = (nodes: Readonly<Record<string, SceneNode>>): readonly SceneNode[] =>
  Object.values(nodes);

const cubeBounds = (cube: CubeNode) =>
  cube.geometryMode === 'axis-box'
    ? cube.bounds
    : { from: cube.orientedBox.unrotatedFrom, to: cube.orientedBox.unrotatedTo };

const cubeHeight = (node: SceneNode | undefined): number | null => {
  if (!node || node.kind !== 'cube') return null;
  const b = cubeBounds(node);
  return b.to[1] - b.from[1];
};

const cubeMinY = (node: SceneNode | undefined): number | null => {
  if (!node || node.kind !== 'cube') return null;
  return cubeBounds(node).from[1];
};

// 1. Parametric components (`param` defaults, parenthesized overrides, `number` alias, scaling, errors).
{
  const kitSource = `ashfox 1
module kit {
  export rig contract UnitRig {
    handedness = right;
    joint root { role = root; channels = rotation; }
  }
  export skeleton UnitSkel implements UnitRig {
    bind root { parent_origin = (0u, 0u, 0u); }
  }
  export surface contract BoxSkin { chart shaft box { coverage = opaque; } chart cap box { coverage = opaque; } material = opaque; }
  export component Pillar(param height_scale : number = 1.0, param cap_height : unit = 2u) {
    requires rig skeleton : UnitRig;
    requires surface skin : BoxSkin;
    bind bone root to skeleton.root;
    geometry {
      bone root {
        cube shaft { origin = (-2u, 0u, -2u); size = (4u, 10u * height_scale, 4u); surface = skin.shaft; }
        cube cap { origin = (-3u, 10u * height_scale, -3u); size = (6u, cap_height, 6u); surface = skin.cap; }
      }
    }
  }
}`;
  const skinDecl = `surface paint : kit.BoxSkin { material = opaque; texture t { density = 1; atlas = (64px, 64px); background = bg; background_alpha = 255; palette { bg = #ffffff; fillc = (#557788, #88aabb, #aaccee); } chart shaft box { fill = fillc; } chart cap box { fill = fillc; } } }`;
  const modelHeader = `ashfox 1
model hero {
  import "shared/kit" as kit;
  settings { density = 16; forward = north; profile = prop; }
  skeleton = kit.UnitSkel;
  ${skinDecl}`;

  const defaultResult = compileSingleModelWs(
    kitSource,
    `${modelHeader}\n  use kit.Pillar as p { skeleton = kit.UnitRig; skin = paint; }\n}`,
  );
  assert.ok(defaultResult.ok, JSON.stringify(defaultResult));
  const defaultProduct = defaultResult.products.find((p) => p.kind === 'model')!;
  if (defaultProduct.kind === 'model') {
    const defShaft = nodeList(defaultProduct.model.scene.nodes).find(
      (n) => n.kind === 'cube' && n.id.includes('shaft'),
    );
    assert.equal(cubeHeight(defShaft), 10);
  }

  const overrideResult = compileSingleModelWs(
    kitSource,
    `${modelHeader}\n  use kit.Pillar(height_scale = 1.5, cap_height = 4u) as p { skeleton = kit.UnitRig; skin = paint; }\n}`,
  );
  assert.ok(overrideResult.ok, JSON.stringify(overrideResult));
  const overProduct = overrideResult.products.find((p) => p.kind === 'model')!;
  if (overProduct.kind === 'model') {
    const overShaft = nodeList(overProduct.model.scene.nodes).find(
      (n) => n.kind === 'cube' && n.id.includes('shaft'),
    );
    const overCap = nodeList(overProduct.model.scene.nodes).find(
      (n) => n.kind === 'cube' && n.id.includes('cap'),
    );
    assert.equal(cubeHeight(overShaft), 15);
    assert.equal(cubeHeight(overCap), 4);
  }

  const typoResult = compileSingleModelWs(
    kitSource,
    `${modelHeader}\n  use kit.Pillar(heigth_scale = 2.0) as p { skeleton = kit.UnitRig; skin = paint; }\n}`,
  );
  assert.equal(typoResult.ok, false);
  if (!typoResult.ok) {
    const unknown = typoResult.diagnostics.find((d) => d.code === 'asset.unknown-parameter');
    assert.ok(unknown?.message.includes('Did you mean "height_scale"'), unknown?.message);
  }

  const badTypeResult = compileSingleModelWs(
    kitSource,
    `${modelHeader}\n  use kit.Pillar(height_scale = 5deg) as p { skeleton = kit.UnitRig; skin = paint; }\n}`,
  );
  assert.equal(badTypeResult.ok, false);

  const requiredKit = kitSource.replace('= 1.0', '');
  const missingResult = compileSingleModelWs(
    requiredKit,
    `${modelHeader}\n  use kit.Pillar as p { skeleton = kit.UnitRig; skin = paint; }\n}`,
  );
  assert.equal(missingResult.ok, false);
  if (!missingResult.ok) {
    assert.ok(missingResult.diagnostics.some((d) => d.code === 'asset.missing-parameter'));
  }
}

// 2. Deterministic static `for i in start..end` unrolling + `${i}` across model/structure/vfx/sprite.
{
  const kitSource = `ashfox 1
module kit {
  export rig contract SpineRig {
    handedness = right;
    joint root { role = root; channels = rotation; }
  }
  export skeleton SpineSkel implements SpineRig {
    bind root { parent_origin = (0u, 0u, 0u); }
  }
  export surface contract SpineSkin { chart body box { coverage = opaque; } material = opaque; }
  export component Stack {
    requires rig skeleton : SpineRig;
    requires surface skin : SpineSkin;
    bind bone root to skeleton.root;
    geometry {
      bone root {
        for i in 0..4 {
          cube seg_\${i} { origin = (-1u, (i * 4)u, -1u); size = (2u, 2u, 2u); surface = skin.body; }
        }
      }
    }
  }
}`;
  const modelSrc = `ashfox 1
model hero {
  import "shared/kit" as kit;
  settings { density = 16; forward = north; profile = prop; }
  skeleton = kit.SpineSkel;
  surface s : kit.SpineSkin { material = opaque; texture t { density = 1; atlas = (32px, 32px); background = bg; background_alpha = 255; palette { bg = #ffffff; fillc = (#884422, #cc6644, #ee9977); } chart body box { fill = fillc; } } }
  use kit.Stack { skeleton = kit.SpineRig; skin = s; }
}`;
  const modelRes = compileSingleModelWs(kitSource, modelSrc);
  assert.ok(modelRes.ok, JSON.stringify(modelRes));
  const modelProd = modelRes.products.find((p) => p.kind === 'model')!;
  if (modelProd.kind === 'model') {
    const cubes = nodeList(modelProd.model.scene.nodes).filter(
      (n): n is CubeNode => n.kind === 'cube',
    );
    assert.deepEqual(
      cubes.map((c) => [c.id.slice(c.id.lastIndexOf('seg_')), cubeMinY(c)]),
      [
        ['seg_0', 0],
        ['seg_1', 4],
        ['seg_2', 8],
        ['seg_3', 12],
      ],
    );
  }

  // Structure with integer division `(6 - (i / 3) * 2)b`.
  const structUnit = parseStructureSource(
    `ashfox 1
structure stepped_tower {
  size = (16b, 12b, 16b);
  palette { stone = "minecraft:stone_bricks"; }
  for i in 0..6 {
    box { from = (0b, (i)b, 0b); to = ((6 - (i / 3) * 2)b, (i)b, 2b); block = stone; }
  }
}`,
    'stepped_tower.ashfox',
  );
  assert.equal(structUnit.ops.length, 6);
  const lastBox = structUnit.ops[5]!;
  assert.equal('to' in lastBox && lastBox.to ? lastBox.to[0] : null, 4);

  // Non-loop string placeholders like `${facing}` are left untouched by static `for`.
  const untouchedString = parseAshfoxProgram('ashfox 1\nstructure s { note = "tag_${facing}"; }');
  assert.equal(untouchedString.diagnostics.length, 0);

  // VFX static `for` unrolling with time offset arithmetic and ${i} identifier interpolation.
  const vfxSrc = `ashfox 1
vfx multi_burst {
  duration = 1.0s;
  fps = 24;
  loop = once;
  palette burst_pal { core = #fff4c2; mid = #ff962a; edge = #cc3311; smoke = #44332a; }
  palette = burst_pal;
  for i in 0..2 {
    element ring_\${i} : slash_arc {
      at = (0.05 + i * 0.15)s..(0.35 + i * 0.15)s;
      blend = additive;
      radius = (4 + i * 2)u..(10 + i * 2)u;
      arc = -60deg..60deg;
      texture slash_streak { posterize = 4; bristles = 50%; seed = 7; }
      scale = 0.8 -> 1.1;
      alpha = 0.5 -> 1.0 -> 0.0;
    }
    emitter spark_\${i} : voxel_burst {
      at = (0.1 + i * 0.2)s..(0.4 + i * 0.2)s;
      count = 12 + i * 4;
      shape = cone(45deg, 2u);
      particle = shard;
      speed = 10u..18u;
      life = 0.25s..0.4s;
      size_over_life = 1.0u -> 0u;
      color_over_life = core -> mid -> edge;
      blend = additive;
    }
  }
}`;
  const vfxParsed = parseVfxSource(vfxSrc, 'multi_burst.ashfox');
  assert.ok(vfxParsed.recipe);
  assert.equal(vfxParsed.recipe.elements.length, 2);
  assert.equal(vfxParsed.recipe.emitters.length, 2);
  const vfxWs = compileDirectoryWorkspace(
    JSON.stringify({
      format: 'ashfox-workspace',
      version: 2,
      name: 'vfx_loop',
      packages: [
        {
          name: 'fx',
          root: 'assets',
          manifest: {
            format: 'ashfox-package',
            version: 1,
            entries: [{ name: 'multi_burst', path: 'vfx/multi_burst.ashfox' }],
            modules: [],
            dependencies: [],
          },
        },
      ],
      include: ['assets/**/*.ashfox'],
      ignore: [],
      build: { directory: 'dist/build' },
      exports: [],
    }),
    [{ path: 'assets/vfx/multi_burst.ashfox', source: vfxSrc }],
  );
  assert.ok(vfxWs.ok, JSON.stringify(vfxWs));

  // Sprite static `for` unrolling with pixel arithmetic and ${i} identifier interpolation.
  const spriteSrc = `ashfox 1
sprite rune_bars {
  profile = item;
  canvas = (32px, 32px);
  palette { highlight = #fff5cc; }
  material gold { ramp { mode = auto; base = #ffd24a; preset = metal; } }
  for i in 0..4 {
    rect bar_\${i} {
      x = (4 + i * 6)px;
      y = 6px;
      width = 3px;
      height = (6 + i * 2)px;
      material = gold;
      shade { form = round; light = top_left; contrast = 2; }
    }
  }
  outline rim { mode = sel_out; strength = 2; inner_rim = true; }
}`;
  const spriteParsed = parseSpriteSource(spriteSrc, 'rune_bars.ashfox');
  assert.ok(spriteParsed.item);
  const spriteWs = compileDirectoryWorkspace(
    JSON.stringify({
      format: 'ashfox-workspace',
      version: 2,
      name: 'sprite_loop',
      packages: [
        {
          name: 'sp',
          root: 'assets',
          manifest: {
            format: 'ashfox-package',
            version: 1,
            entries: [{ name: 'rune_bars', path: 'sprites/rune_bars.ashfox' }],
            modules: [],
            dependencies: [],
          },
        },
      ],
      include: ['assets/**/*.ashfox'],
      ignore: [],
      build: { directory: 'dist/build' },
      exports: [],
    }),
    [{ path: 'assets/sprites/rune_bars.ashfox', source: spriteSrc }],
  );
  assert.ok(spriteWs.ok, JSON.stringify(spriteWs));
  const spriteProd = spriteWs.products[0]!;
  if (spriteProd.kind === 'sprite') assert.ok(spriteProd.sprite.png.length > 0);
}

// 3. Static `for` fail-closed safety budgets.
{
  const overIter = parseAshfoxProgram(
    'ashfox 1\nstructure s { for i in 0..129 { box { from = (0b, 0b, 0b); to = (1b, 1b, 1b); block = a; } } }',
  );
  assert.ok(overIter.diagnostics.some((d) => d.code === 'program.static-for-iter-budget'));

  const overDepth = parseAshfoxProgram(
    'ashfox 1\nstructure s { for a in 0..1 { for b in 0..1 { for c in 0..1 { for d in 0..1 { box { from = (0b,0b,0b); to = (1b,1b,1b); block = x; } } } } } }',
  );
  assert.ok(overDepth.diagnostics.some((d) => d.code === 'program.static-for-depth-budget'));

  const nonConst = parseAshfoxProgram(
    'ashfox 1\nstructure s { for i in 0..n { box { from = (0b,0b,0b); to = (1b,1b,1b); block = x; } } }',
  );
  assert.ok(nonConst.diagnostics.some((d) => d.code === 'program.static-for-non-constant'));

  const unitBound = parseAshfoxProgram(
    'ashfox 1\nstructure s { for i in 0..4b { box { from = (0b,0b,0b); to = (1b,1b,1b); block = x; } } }',
  );
  assert.ok(unitBound.diagnostics.some((d) => d.code === 'program.static-for-non-integer-bound'));

  const negInterp = parseAshfoxProgram(
    'ashfox 1\nstructure s { for i in -1..1 { cube b_${i} {} } }',
  );
  assert.ok(
    negInterp.diagnostics.some((d) => d.code === 'program.static-for-negative-interpolation'),
  );
}

// 4. `variant` matrix elaboration, directory compilation, exports, modularity, and shared dedup.
{
  const moduleSrc = `ashfox 1
module kit {
  export rig contract BoxRig {
    handedness = right;
    joint root { role = root; channels = rotation; }
  }
  export skeleton BoxSkel implements BoxRig {
    bind root { parent_origin = (0u, 0u, 0u); }
  }
  export surface contract BoxSkin { chart body box { coverage = opaque; } material = opaque; }
  export component Crate(param scale_h : number = 1.0) {
    requires rig skeleton : BoxRig;
    requires surface skin : BoxSkin;
    bind bone root to skeleton.root;
    geometry { bone root { cube body { origin = (-2u, 0u, -2u); size = (4u, 4u * scale_h, 4u); surface = skin.body; } } }
  }
}`;
  const skinSrc = `ashfox 1
module skins {
  import "./kit.ashfox" as kit;
  export surface iron_skin : kit.BoxSkin { material = opaque; texture t { density = 1; atlas = (32px, 32px); background = bg; background_alpha = 255; palette { bg = #ffffff; fillc = (#556677, #8a94a6, #bcc6d6); } chart body box { fill = fillc; } } }
}`;
  const variantModelSrc = `ashfox 1
model crate {
  import "shared/kit" as kit;
  import "shared/skins" as skins;
  settings { density = 16; forward = north; profile = prop; }
  skeleton = kit.BoxSkel;
  use kit.Crate(scale_h = h_scale) as box_inst { skeleton = kit.BoxRig; skin = skins.iron_skin; }
  variant standard { h_scale = 1.0; }
  variant tall { h_scale = 1.75; }
}`;
  const elaborated = elaborateModelVariants(variantModelSrc, 'assets/models/crate.ashfox');
  assert.deepEqual(
    elaborated.map((v) => v.modelId),
    ['crate_standard', 'crate_tall'],
  );

  const moduleVariantParse = parseAssetSource(
    'ashfox 1\nmodule bad { variant v { a = 1; } }',
    'bad.ashfox',
  );
  assert.ok(moduleVariantParse.diagnostics.length > 0);

  const wsCfg = JSON.stringify({
    format: 'ashfox-workspace',
    version: 2,
    name: 'variant_ws',
    packages: [
      {
        name: 'models',
        root: 'assets/models',
        manifest: {
          format: 'ashfox-package',
          version: 1,
          entries: [{ name: 'crate', path: 'crate.ashfox' }],
          modules: [],
          dependencies: [{ name: 'shared' }],
        },
      },
      {
        name: 'shared',
        root: 'assets/module',
        manifest: {
          format: 'ashfox-package',
          version: 1,
          entries: [],
          modules: [
            { subpath: './kit', path: 'kit.ashfox' },
            { subpath: './skins', path: 'skins.ashfox' },
          ],
          dependencies: [],
        },
      },
    ],
    include: ['assets/**/*.ashfox'],
    ignore: [],
    build: { directory: 'dist/build' },
    exports: [
      {
        name: 'crate_standard',
        entry: { packageName: 'models', entryName: 'crate_standard' },
        format: 'glb',
        directory: 'dist/standard',
      },
      {
        name: 'crate_tall',
        entry: { packageName: 'models', entryName: 'crate_tall' },
        format: 'glb',
        directory: 'dist/tall',
      },
    ],
  });
  const compiled = compileDirectoryWorkspace(wsCfg, [
    { path: 'assets/module/kit.ashfox', source: moduleSrc },
    { path: 'assets/module/skins.ashfox', source: skinSrc },
    { path: 'assets/models/crate.ashfox', source: variantModelSrc },
  ]);
  assert.ok(compiled.ok, JSON.stringify(compiled));
  if (compiled.ok) {
    const byName = new Map(compiled.products.map((p) => [p.entry.entryName, p]));
    const stdModel = byName.get('crate_standard')!;
    const tallModel = byName.get('crate_tall')!;
    assert.equal(stdModel.kind, 'model');
    assert.equal(tallModel.kind, 'model');
    if (stdModel.kind === 'model' && tallModel.kind === 'model') {
      const stdCube = nodeList(stdModel.model.scene.nodes).find((n) => n.kind === 'cube');
      const tallCube = nodeList(tallModel.model.scene.nodes).find((n) => n.kind === 'cube');
      assert.equal(cubeHeight(stdCube), 4);
      assert.equal(cubeHeight(tallCube), 7);
      // Shared unchanged texture atlas stays content-identical across elaborated variants.
      assert.deepEqual(stdModel.model.textures[0], tallModel.model.textures[0]);
    }
  }
}

console.log('parametric components, static for unrolling, and variant elaboration tests ok');
