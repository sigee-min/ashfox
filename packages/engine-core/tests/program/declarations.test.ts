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

const soundMod = `ashfox-model 1
module tones {
  export voice ping = {
    source = {
      kind = "resonator";
      excitation = { kind = "impulse"; };
      modes = [{ id = "body"; hz = 640; decay = 0.35; gain = 1; }];
    };
    gain = { domain = "linear"; interpolation = "smooth"; points = [{ at = 0; value = 0; }, { at = 0.05; value = 0.8; }, { at = 1; value = 0; }]; };
    highpass = 120;
    lowpass = 6000;
  };
  export sequence chime = {
    start = 0;
    repeat = { count = 1; period = 0; };
    steps = [{
      id = "hit";
      voice = "ping";
      at = 0;
      duration = 0.35;
      gain = 1;
      pitchCents = 0;
      vary = { timing = [0, 0]; pitchCents = [0, 0]; gain = [1, 1]; duration = [1, 1]; };
    }];
  };
}`;

const soundEntry = `ashfox-model 1
sound bell {
  import "../module/tones.ashfox" as t;
  outputs { wav; }
  preview default { width = 320; height = 160; variant = "main"; }
  duration = 0.5;
  sampleRate = 48000;
  seed = 7;
  voices = [t.ping];
  sequences = [t.chime];
  variants = [{ id = "main"; seed = 1; }];
  playback = { kind = "oneshot"; };
  output = { gainDb = -12; peakDb = -3; };
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

const envGain = `{ domain = "linear"; interpolation = "smooth"; points = [{ at = 0; value = 0; }, { at = 0.05; value = 0.8; }, { at = 1; value = 0; }]; }`;

// Sound hygiene: unused import & unused local voice fail.
const deadSoundImport = compileDirectoryWorkspace(
  ws(
    [{ name: 'bell', path: 'sounds/bell.ashfox' }],
    [{ subpath: './tones', path: 'module/tones.ashfox' }],
  ),
  [
    {
      path: 'assets/sounds/bell.ashfox',
      source: `ashfox-model 1
sound bell {
  import "../module/tones.ashfox" as t;
  duration = 0.4; sampleRate = 48000; seed = 1;
  voices = [{ id = "v"; source = { kind = "noise"; }; gain = ${envGain}; highpass = 100; lowpass = 3000; }];
  sequences = [{ id = "s"; start = 0; repeat = { count = 1; period = 0; }; steps = [{ id = "k"; voice = "v"; at = 0; duration = 0.3; gain = 1; pitchCents = 0; vary = { timing = [0,0]; pitchCents = [0,0]; gain = [1,1]; duration = [1,1]; }; }]; }];
  variants = [{ id = "main"; seed = 1; }];
  playback = { kind = "oneshot"; };
  output = { gainDb = -12; peakDb = -3; };
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
      source: `ashfox-model 1
sound bad {
  outputs { glb; }
  duration = 0.4; sampleRate = 48000; seed = 1;
  voices = [{ id = "v"; source = { kind = "noise"; }; gain = ${envGain}; highpass = 100; lowpass = 3000; }];
  sequences = [{ id = "s"; start = 0; repeat = { count = 1; period = 0; }; steps = [{ id = "k"; voice = "v"; at = 0; duration = 0.3; gain = 1; pitchCents = 0; vary = { timing = [0,0]; pitchCents = [0,0]; gain = [1,1]; duration = [1,1]; }; }]; }];
  variants = [{ id = "main"; seed = 1; }];
  playback = { kind = "oneshot"; };
  output = { gainDb = -12; peakDb = -3; };
}`,
    },
  ],
);
assert.equal(badSoundOut.ok, false);
assert.match(badSoundOut.diagnostics[0]!.message, /does not match sound asset/);

// Sprite declarations + unused declaration hygiene.
const spriteMod = `ashfox-model 1
module sprite_parts {
  export mask square { rows = ["11111111", "11111111", "11111111", "11111111", "11111111", "11111111", "11111111", "11111111"]; }
  export material gold { ramp { mode = "explicit"; colors = [#6c4a12, #c99728, #ffe16e]; } }
}`;
const spriteWithPreview = `ashfox-model 1
sprite badge {
  import "../module/sprite_parts.ashfox" as parts;
  outputs { png; }
  preview silhouette { stage = silhouette; scale = 8; background = checker; }
  profile = "minecraft-item-v1";
  canvas = [16, 16];
  palette { bg = #101014; }
  part base {
    mask = "parts.square";
    material = "parts.gold";
    at = [4, 4];
    shade { form = "round"; light = "top_left"; contrast = 2; }
    grain { mode = "clustered-v1"; amount = 0; seed = 7; }
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

const deadSpriteImportSrc = `ashfox-model 1
sprite badge {
  import "../module/sprite_parts.ashfox" as unused_parts;
  profile = "minecraft-item-v1";
  canvas = [16, 16];
  palette { c = #ffffff; }
  paint dot { at = [4, 4]; rows = ["cc", "cc"]; colors { c = "c"; } }
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
const structSrc = `ashfox-model 1
structure kiosk {
  outputs { java_structure; glb encoding = optimized; }
  preview cut { cutaway = 2; camera = perspective; azimuth = 30; }
  size = (5, 5, 5);
  palette {
    stone = "minecraft:stone_bricks";
    door_bot = "minecraft:oak_door[facing=north,half=lower,hinge=left,open=false]";
    door_top = "minecraft:oak_door[facing=north,half=upper,hinge=left,open=false]";
    torch = "minecraft:torch";
    bed = "minecraft:red_bed[facing=north,part=head]";
  }
  build {
    box from = (0, 0, 0) to = (4, 0, 4) block = stone;
    walls from = (0, 1, 0) to = (4, 3, 4) block = stone;
    set at = (2, 1, 4) block = door_bot;
    set at = (2, 2, 4) block = door_top;
    set at = (1, 1, 1) block = bed;
    set at = (3, 1, 1) block = torch;
  }
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
const modelSrc = `ashfox-model 1
asset totem {
  outputs { gltf encoding = optimized; }
  preview spin { kind = gif; mode = turntable; fps = 8; duration = 1; }
  export rig contract R {
    handedness = right;
    frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
    joint root { parent = none; role = root; frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } channels = rotation; mirror = none; }
  }
  export skeleton S implements R {
    bind root { parent-origin = (0u, 0u, 0u); frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } }
  }
  export surface contract C { chart body box { coverage = opaque; } material = opaque; }
  export surface tex: C {
    material = opaque;
    texture atlas { background = bg; background-alpha = 255; palette { bg = #202020; t = (#444444, #888888, #cccccc); } chart body box { fill = t; } }
  }
  export component B {
    requires rig s: R;
    requires surface k: C;
    bind bone root to s.root;
    geometry { bone root { cube body { origin = (-2u, 0u, -2u); size = (4u, 4u, 4u); surface = k.body; } } }
  }
  export asset totem { settings { density = 16; forward = north; profile = prop; } skeleton = S; use B as b { bind s = R; bind k = tex; }; }
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
