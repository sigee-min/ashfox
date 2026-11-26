import assert from 'node:assert/strict';
import { compileDirectoryWorkspace, inspectNativeSource, type DirectoryFile } from '../../src';

const ws = (
  entries: readonly { readonly name: string; readonly path: string }[],
  modules: readonly { readonly subpath: string; readonly path: string }[],
  pkgRoot = 'assets',
): string =>
  JSON.stringify({
    format: 'ashfox-workspace',
    version: 2,
    name: 'decl-test',
    packages: [
      {
        name: 'p',
        root: pkgRoot,
        manifest: { format: 'ashfox-package', version: 1, entries, modules, dependencies: [] },
      },
    ],
    include: ['assets/**/*.ashfox'],
    ignore: [],
    build: { directory: 'dist/build' },
    exports: [],
  });

const soundMod = `ashfox 1
module tones {
  export voice ping : resonator {
    excitation impulse {}
    mode body { hz = 640hz; decay = 0.35s; gain = 1; }
    gain = 0 -> 0.8 -> 0;
    highpass = 120hz;
    lowpass = 6000hz;
  }
  export seq chime {
    start = 0s;
    step hit { voice = ping; at = 0s; duration = 0.35s; gain = 1; pitch_cents = 0cents; }
  }
}`;

const soundEntry = `ashfox 1
sound bell {
  import "../module/tones.ashfox" as t;
  outputs { wav; }
  preview default { width = 320; height = 160; variant = main; }
  profile = ui;
  duration = 0.5s;
  seed = 7;
  voices = [t.ping];
  sequences = [t.chime];
  variant main { seed = 1; }
  output { gain_db = -12db; peak_db = -3db; }
}`;

const compiledSound = compileDirectoryWorkspace(
  ws(
    [{ name: 'bell', path: 'sounds/bell.ashfox' }],
    [{ subpath: './tones', path: 'module/tones.ashfox' }],
  ),
  [
    { path: 'assets/sounds/bell.ashfox', source: soundEntry },
    { path: 'assets/module/tones.ashfox', source: soundMod },
  ],
);
assert.equal(
  compiledSound.ok,
  true,
  compiledSound.ok ? '' : JSON.stringify(compiledSound.diagnostics),
);
const soundProduct = compiledSound.products[0]!;
assert.equal(soundProduct.kind, 'sound');
assert.deepEqual(soundProduct.declarations.outputs, [{ format: 'wav' }]);
assert.deepEqual(soundProduct.declarations.previews, [
  { name: 'default', width: 320, height: 160, variant: 'main' },
]);

const deadSoundImport = compileDirectoryWorkspace(
  ws(
    [{ name: 'bell', path: 'sounds/bell.ashfox' }],
    [{ subpath: './tones', path: 'module/tones.ashfox' }],
  ),
  [
    {
      path: 'assets/sounds/bell.ashfox',
      source: `ashfox 1
sound bell {
  import "../module/tones.ashfox" as t;
  profile = ui;
  duration = 0.4s; seed = 1;
  voice v : noise { color = white; gain = 0 -> 0.8 -> 0; highpass = 100hz; lowpass = 3000hz; }
  seq s { start = 0s; step k { voice = v; at = 0s; duration = 0.3s; } }
  variant main { seed = 1; }
  output { gain_db = -12db; peak_db = -3db; }
}`,
    },
    { path: 'assets/module/tones.ashfox', source: soundMod },
  ],
);
assert.equal(deadSoundImport.ok, false);
assert.match(deadSoundImport.diagnostics[0]!.message, /sound\.unused-import/);

// Sound declarations rejected for invalid output / mismatched preview field.
const badSoundOut = compileDirectoryWorkspace(
  ws([{ name: 'bad', path: 'sounds/bad.ashfox' }], []),
  [
    {
      path: 'assets/sounds/bad.ashfox',
      source: `ashfox 1
sound bad {
  outputs { glb; }
  profile = ui;
  duration = 0.4s; seed = 1;
  voice v : noise { color = white; gain = 0 -> 0.8 -> 0; highpass = 100hz; lowpass = 3000hz; }
  seq s { start = 0s; step k { voice = v; at = 0s; duration = 0.3s; } }
  variant main { seed = 1; }
  output { gain_db = -12db; peak_db = -3db; }
}`,
    },
  ],
);
assert.equal(badSoundOut.ok, false);
assert.match(badSoundOut.diagnostics[0]!.message, /does not match sound asset/);

// Sprite declarations + unused declaration hygiene.
const spriteMod = `ashfox 1
module sprite_parts {
  export mask square { rows = ["11111111", "11111111", "11111111", "11111111", "11111111", "11111111", "11111111", "11111111"]; }
  export material gold { ramp { mode = explicit; colors = [#6c4a12, #c99728, #ffe16e]; } }
}`;
const spriteWithPreview = `ashfox 1
sprite badge {
  import "../module/sprite_parts.ashfox" as parts;
  outputs { png; }
  preview silhouette { stage = silhouette; scale = 8; background = checker; }
  profile = item;
  canvas = (16px, 16px);
  palette { bg = #101014; }
  part base {
    mask = parts.square;
    material = parts.gold;
    at = (4px, 4px);
    shade { form = round; light = top_left; contrast = 2; }
    grain clustered { amount = 0; seed = 7; }
    patches = [];
  }
}`;
const okSprite = compileDirectoryWorkspace(
  ws(
    [{ name: 'badge', path: 'sprites/badge.ashfox' }],
    [{ subpath: './sprite_parts', path: 'module/sprite_parts.ashfox' }],
  ),
  [
    { path: 'assets/sprites/badge.ashfox', source: spriteWithPreview },
    { path: 'assets/module/sprite_parts.ashfox', source: spriteMod },
  ],
);
assert.equal(okSprite.ok, true, okSprite.ok ? '' : JSON.stringify(okSprite.diagnostics));
assert.deepEqual(okSprite.products[0]!.declarations.previews, [
  { name: 'silhouette', stage: 'silhouette', scale: 8, background: 'checker' },
]);

const deadSpriteImportSrc = `ashfox 1
sprite badge {
  import "../module/sprite_parts.ashfox" as unused_parts;
  profile = item;
  canvas = (16px, 16px);
  palette { c = #ffffff; }
  paint dot { at = (4px, 4px); rows = ["cc", "cc"]; colors { c = c; } }
}`;
const deadSpriteImportRes = compileDirectoryWorkspace(
  ws(
    [{ name: 'badge', path: 'sprites/badge.ashfox' }],
    [{ subpath: './sprite_parts', path: 'module/sprite_parts.ashfox' }],
  ),
  [
    { path: 'assets/sprites/badge.ashfox', source: deadSpriteImportSrc },
    { path: 'assets/module/sprite_parts.ashfox', source: spriteMod },
  ],
);
assert.equal(deadSpriteImportRes.ok, false);
assert.equal(deadSpriteImportRes.diagnostics[0]!.code, 'sprite.unused-import');

// inspectNativeSource discovers sound module and entry outputs accurately.
const metaSound = inspectNativeSource(soundEntry, 'bell.ashfox');
assert.equal(metaSound.kind, 'sound');
assert.deepEqual(metaSound.imports, ['../module/tones.ashfox']);
assert.equal(metaSound.outputs.length, 1);
const metaMod = inspectNativeSource(soundMod, 'tones.ashfox');
assert.equal(metaMod.kind, 'module');

// Structure declarations: outputs { java_structure; glb encoding = optimized; } + preview cutaway.
const structSrc = `ashfox 1
structure kiosk {
  outputs { java_structure; glb encoding = optimized; }
  preview cut { cutaway = 2b; camera = perspective; azimuth = 30deg; }
  size = (5b, 5b, 5b);
  palette {
    stone = "minecraft:stone_bricks";
    door_bot = "minecraft:oak_door[facing=north,half=lower,hinge=left,open=false]";
    door_top = "minecraft:oak_door[facing=north,half=upper,hinge=left,open=false]";
    torch = "minecraft:torch";
    bed = "minecraft:red_bed[facing=north,part=head]";
  }
  box { from = (0b, 0b, 0b); to = (4b, 0b, 4b); block = stone; }
  walls { from = (0b, 1b, 0b); to = (4b, 3b, 4b); block = stone; }
  set { at = (2b, 1b, 4b); block = door_bot; }
  set { at = (2b, 2b, 4b); block = door_top; }
  set { at = (1b, 1b, 1b); block = bed; }
  set { at = (3b, 1b, 1b); block = torch; }
}`;
const structRes = compileDirectoryWorkspace(
  ws([{ name: 'kiosk', path: 'structures/kiosk.ashfox' }], []),
  [{ path: 'assets/structures/kiosk.ashfox', source: structSrc }],
);
assert.equal(structRes.ok, true, structRes.ok ? '' : JSON.stringify(structRes.diagnostics));
assert.deepEqual(structRes.products[0]!.declarations.outputs, [
  { format: 'java_structure' },
  { format: 'glb', encoding: 'optimized' },
]);
assert.deepEqual(structRes.products[0]!.declarations.previews, [
  { name: 'cut', cutaway: 2, camera: 'perspective', azimuth: 30 },
]);

// Model declarations: gltf output & turntable gif preview.
const modelSrc = `ashfox 1
model totem {
  outputs { gltf encoding = optimized; }
  preview spin { kind = gif; mode = turntable; fps = 8; duration = 1; }
  export rig contract R {
    handedness = right;
    frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
    joint root { parent = none; role = root; frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } channels = rotation; mirror = none; }
  }
  export skeleton S implements R {
    bind root { parent_origin = (0u, 0u, 0u); frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } }
  }
  export surface contract C { chart body box { coverage = opaque; } material = opaque; }
  export surface tex: C {
    material = opaque;
    texture atlas { background = bg; background_alpha = 255; palette { bg = #202020; t = (#444444, #888888, #cccccc); } chart body box { fill = t; } }
  }
  export component B {
    requires rig s: R;
    requires surface k: C;
    bind bone root to s.root;
    geometry { bone root { cube body { origin = (-2u, 0u, -2u); size = (4u, 4u, 4u); surface = k.body; } } }
  }
  settings { density = 16; forward = north; profile = prop; } skeleton = S; use B as b { s = R; k = tex; }
}`;
const modelRes = compileDirectoryWorkspace(
  ws([{ name: 'totem', path: 'models/totem.ashfox' }], []),
  [{ path: 'assets/models/totem.ashfox', source: modelSrc }],
);
assert.equal(modelRes.ok, true, modelRes.ok ? '' : JSON.stringify(modelRes.diagnostics));
assert.deepEqual(modelRes.products[0]!.declarations.outputs, [
  { format: 'gltf', encoding: 'optimized' },
]);
assert.deepEqual(modelRes.products[0]!.declarations.previews, [
  { name: 'spin', kind: 'gif', mode: 'turntable', fps: 8, duration: 1 },
]);

console.log('declarations & 4-kind sound/sprite/structure/model hygiene tests ok');
