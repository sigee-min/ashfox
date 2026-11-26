import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import {
  compileSpriteDocument,
  parseSpriteSource,
  readSpriteDocument,
  spritePreviewPng,
} from '../../src/index';
import { materialRamp } from '../../src/compiler/sprite/ramp';
import { baseTone, grainDelta } from '../../src/compiler/sprite/shade';

const swordSource = `ashfox 1
sprite blade {
  export material steel { ramp { mode = auto; base = #7b93a8; preset = metal; } }
  export material gold { ramp { mode = auto; base = #d8a642; preset = warm; } }
  export material grip { ramp { mode = explicit; colors = [#3d2934, #6b433c, #9a6959]; } }
  profile = item;
  canvas = (32px, 32px);
  palette { gem = #4cc9f0; }
  polygon blade_body {
    points = [(24px, 4px), (27px, 4px), (27px, 7px), (12px, 22px), (9px, 19px)];
    material = steel;
    shade { form = bevel; light = top_left; contrast = 2; specular = 2; axis = [(9px, 22px), (27px, 4px)]; }
    grain directional { axis = diagonal; amount = 1; seed = 11; }
  }
  capsule guard {
    from = (6px, 18px); to = (14px, 26px); radius = 1.6px;
    material = gold;
    shade { form = round; light = top_left; contrast = 2; specular = 1; }
  }
  line handle {
    from = (4px, 27px); to = (10px, 21px); thickness = 2px;
    material = grip;
    shade { form = cylinder; light = top_left; contrast = 2; }
  }
  paint gem_dot { at = (9px, 21px); rows = ["gg", "gg"]; colors { g = gem; } }
  outline edge { mode = sel_out; strength = 2; inner_rim = true; }
}`;

const parsed = parseSpriteSource(swordSource, 'blade.ashfox');
assert.equal(parsed.kind, 'sprite');
const docInput = {
  masks: parsed.masks,
  materials: parsed.materials,
  stamps: parsed.stamps,
  item: parsed.item!,
};
const validated = readSpriteDocument(docInput, 'blade.ashfox');
assert.ok(Object.isFrozen(validated.item.layers));

const built = compileSpriteDocument(docInput, 'blade.ashfox');
assert.equal(built.ok, true, built.ok ? '' : JSON.stringify(built.diagnostics));
if (!built.ok) throw new Error('expected sprite build');
const prod = built.products[0]!;
assert.equal(prod.receipt.width, 32);
assert.equal(prod.receipt.height, 32);
assert.equal(prod.profile, 'item');
assert.ok(prod.telemetry.outlinePixels > 0);
assert.ok(prod.telemetry.hasRimHighlight);

// Verify determinism & PNG round-trip.
const builtAgain = compileSpriteDocument(docInput, 'blade.ashfox');
assert.equal(builtAgain.ok, true);
if (builtAgain.ok) assert.deepEqual(prod.png, builtAgain.products[0]!.png);

const png = Buffer.from(prod.png);
assert.equal(png.readUInt32BE(16), 32);
assert.equal(png.readUInt32BE(20), 32);
let offset = 8;
const chunks: Buffer[] = [];
while (offset < png.length) {
  const len = png.readUInt32BE(offset);
  if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') {
    chunks.push(png.subarray(offset + 8, offset + 8 + len));
  }
  offset += len + 12;
}
const scan = inflateSync(Buffer.concat(chunks));
assert.equal(scan.length, 32 * (32 * 4 + 1));

// Verify 64x64 seamless tile wraps toroidally across borders.
const tileSource = `ashfox 1
sprite mossy_tile {
  export material stone { ramp { mode = auto; base = #6e747c; preset = stone; } }
  export material moss { ramp { mode = auto; base = #557e46; preset = organic; } }
  export material mortar { ramp { mode = auto; base = #4a4f57; preset = stone; } }
  profile = tile;
  canvas = (32px, 32px);
  palette {}
  fill base_bricks {
    material = stone;
    pattern brick { width = 16px; height = 8px; mortar = 1px; stagger = 8px; seed = 7; mortar_material = mortar; }
    grain clustered { amount = 1; seed = 13; }
  }
  pattern moss_patches {
    material = stone;
    pattern blotch { scale = 4px; density = 0.28; seed = 21; to_material = moss; }
    clip = canvas;
  }
}`;
const parsedTile = parseSpriteSource(tileSource, 'tile.ashfox');
const tileBuilt = compileSpriteDocument(
  {
    masks: parsedTile.masks,
    materials: parsedTile.materials,
    stamps: parsedTile.stamps,
    item: parsedTile.item!,
  },
  'tile.ashfox',
);
assert.equal(tileBuilt.ok, true, tileBuilt.ok ? '' : JSON.stringify(tileBuilt.diagnostics));
if (tileBuilt.ok) {
  assert.equal(tileBuilt.products[0]!.profile, 'tile');
  assert.equal(tileBuilt.products[0]!.telemetry.opaquePixels, 1024);
}

// Verify shade & ramp helpers.
const round = { form: 'round' as const, light: 'top_left' as const, contrast: 2, specular: 0 };
assert.ok(baseTone(round, 0, 0, 5, 5) >= 3);
assert.equal(baseTone(round, 4, 4, 5, 5), 0);
assert.equal(baseTone({ ...round, light: 'bottom_right' }, 0, 0, 5, 5), 0);
assert.equal(baseTone({ ...round, contrast: 0 }, 0, 0, 5, 5), 2);
assert.equal(
  grainDelta({ mode: 'clustered', amount: 1, seed: 23 }, 0, 0),
  grainDelta({ mode: 'clustered', amount: 1, seed: 23 }, 1, 1),
);
assert.equal(
  materialRamp({ id: 't', ramp: { mode: 'auto', base: '#708090', preset: 'metal' } }).length,
  5,
);
assert.ok(spritePreviewPng(prod.raster, 4).length > 100);

// Unknown profile rejected cleanly.
const legacy = swordSource.replace('profile = item;', 'profile = invalid_profile;');
const legacyParsed = parseSpriteSource(legacy, 'legacy.ashfox');
const legacyRes = compileSpriteDocument({
  masks: legacyParsed.masks,
  materials: legacyParsed.materials,
  stamps: legacyParsed.stamps,
  item: legacyParsed.item!,
});
assert.equal(legacyRes.ok, false);

// Non-square canvases are rejected up front to match publishBundle metadata rules.
const rectCanvas = parseSpriteSource(
  swordSource.replace('canvas = (32px, 32px);', 'canvas = (32px, 16px);'),
  'rect.ashfox',
);
assert.equal(
  compileSpriteDocument({
    masks: rectCanvas.masks,
    materials: rectCanvas.materials,
    stamps: rectCanvas.stamps,
    item: rectCanvas.item!,
  }).ok,
  false,
);

// Part bevel axis uses mask-local coordinates and validates [x, y] against [maxW, maxH].
const partMask = Array.from({ length: 8 }, () => '11111111');
const buildPartAt = (ax: number) =>
  compileSpriteDocument({
    masks: [{ id: 'sq', rows: partMask }],
    materials: [{ id: 'steel', ramp: { mode: 'auto', base: '#7b93a8', preset: 'metal' } }],
    stamps: [],
    item: {
      id: 'moved',
      profile: 'item',
      canvas: [32, 32],
      palette: {},
      layers: [
        {
          id: 'p',
          op: 'part',
          mask: 'sq',
          material: 'steel',
          at: [ax, 0],
          shade: {
            form: 'bevel',
            light: 'top_left',
            contrast: 2,
            specular: 2,
            axis: [
              [0, 0],
              [7, 7],
            ],
          },
          grain: { mode: 'none', amount: 0, seed: 1 },
          patches: [],
        },
      ],
    },
  });
const p0 = buildPartAt(0);
const p10 = buildPartAt(10);
assert.equal(p0.ok, true);
assert.equal(p10.ok, true);
if (p0.ok && p10.ok) {
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      assert.equal(
        p0.products[0]!.evidence[y * 32 + x]?.baseTone,
        p10.products[0]!.evidence[y * 32 + (x + 10)]?.baseTone,
      );
    }
  }
}
const tallMask = Array.from({ length: 12 }, () => '1111');
assert.equal(
  compileSpriteDocument({
    masks: [{ id: 'tall', rows: tallMask }],
    materials: [{ id: 'steel', ramp: { mode: 'auto', base: '#7b93a8', preset: 'metal' } }],
    stamps: [],
    item: {
      id: 'tall_axis',
      profile: 'item',
      canvas: [32, 32],
      palette: {},
      layers: [
        {
          id: 'p',
          op: 'part',
          mask: 'tall',
          material: 'steel',
          at: [2, 2],
          shade: {
            form: 'bevel',
            light: 'top_left',
            contrast: 2,
            axis: [
              [1, 8],
              [2, 2],
            ],
          },
          grain: { mode: 'none', amount: 0, seed: 1 },
          patches: [],
        },
      ],
    },
  }).ok,
  true,
);

console.log('sprite compiler: multi-res, shapes, OKLCH ramps, sel-out, seamless tile ok');
