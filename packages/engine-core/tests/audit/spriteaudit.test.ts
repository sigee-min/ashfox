import assert from 'node:assert/strict';
import {
  compileSpriteDocument,
  evaluateSpriteQuality,
  formatSpriteGateFailure,
  parseSpriteSource,
  spriteInspectSheetPng,
} from '../../src/index';

const compileFromSource = (source: string) => {
  const unit = parseSpriteSource(source, 'test.ashfox');
  const res = compileSpriteDocument(
    { masks: unit.masks, materials: unit.materials, stamps: unit.stamps, item: unit.item! },
    'test.ashfox',
  );
  if (!res.ok) throw new Error(JSON.stringify(res.diagnostics));
  return res.products[0]!;
};

// 1. High-craft 32x32 item passes >= 85 and produces 512x512 inspect sheet.
const craftedItem = compileFromSource(`ashfox-model 1
sprite potion_v2 {
  export material glass { ramp { mode = auto; base = #5ea9dc; preset = gem; } }
  export material liquid { ramp { mode = auto; base = #d9466b; preset = vivid; } }
  export material cork { ramp { mode = auto; base = #9b6b43; preset = wood; } }
  profile = item;
  canvas = (32px, 32px);
  palette { glint = #ffffff; }
  shape body {
    shape { kind = ellipse; cx = 15; cy = 18; rx = 9; ry = 8; }
    material = glass;
    shade { form = round; light = top_left; contrast = 2; specular = 2; }
  }
  shape elixir {
    shape { kind = ellipse; cx = 15; cy = 20; rx = 7; ry = 5; }
    material = liquid;
    shade { form = round; light = top_left; contrast = 2; specular = 1; }
    grain { mode = soft; amount = 1; seed = 5; }
  }
  shape neck {
    shape { kind = rect; x = 13; y = 7; width = 6; height = 5; }
    material = glass;
    shade { form = cylinder; light = top_left; contrast = 2; axis = [(16, 7), (16, 12)]; }
  }
  shape stopper {
    shape { kind = rect; x = 13; y = 4; width = 6; height = 3; }
    material = cork;
    shade { form = bevel; light = top_left; contrast = 2; axis = [(13, 6), (18, 4)]; }
  }
  paint spec { at = (11px, 14px); rows = ["gg", "g."]; colors { g = glint; } }
  outline edge { mode = sel_out; strength = 2; innerRim = true; }
}`);
const itemAudit = evaluateSpriteQuality(craftedItem);
assert.equal(itemAudit.passed, true, formatSpriteGateFailure('potion_v2', itemAudit));
assert.ok(itemAudit.score >= 85, `expected >= 85, got ${itemAudit.score}`);
const itemSheet = Buffer.from(spriteInspectSheetPng(craftedItem, itemAudit));
assert.equal(itemSheet.readUInt32BE(16), 512);
assert.equal(itemSheet.readUInt32BE(20), 512);

// 2. Seamless 32x32 stone tile passes >= 85 and produces 512x512 tile inspect sheet.
const craftedTile = compileFromSource(`ashfox-model 1
sprite stone_tile {
  export material stone { ramp { mode = auto; base = #727982; preset = stone; } }
  export material mortar { ramp { mode = auto; base = #50565f; preset = stone; } }
  export material moss { ramp { mode = auto; base = #5c8a47; preset = organic; } }
  profile = tile;
  canvas = (32px, 32px);
  palette {}
  fill blocks {
    material = stone;
    pattern { kind = brick; width = 16; height = 8; mortar = 1; stagger = 8; seed = 42; mortarMaterial = mortar; }
    grain { mode = clustered; amount = 1; seed = 19; }
  }
  pattern lichen {
    material = stone;
    pattern { kind = blotch; scale = 4; density = 0.25; seed = 88; toMaterial = moss; }
    clip = canvas;
  }
}`);
const tileAudit = evaluateSpriteQuality(craftedTile);
assert.equal(tileAudit.passed, true, formatSpriteGateFailure('stone_tile', tileAudit));
assert.ok(tileAudit.score >= 85, `expected tile >= 85, got ${tileAudit.score}`);
const tileSheet = Buffer.from(spriteInspectSheetPng(craftedTile, tileAudit));
assert.equal(tileSheet.readUInt32BE(16), 512);

// 3. Flat crushed-black single square fails hard gates & quality threshold.
const badSprite = compileFromSource(`ashfox-model 1
sprite bad_box {
  export material pitch { ramp { mode = explicit; colors = [#050505, #080808, #0c0c0c]; } }
  profile = item;
  canvas = (16px, 16px);
  palette {}
  shape box {
    shape { kind = rect; x = 4; y = 4; width = 8; height = 8; }
    material = pitch;
    shade { form = flat; light = top_left; contrast = 0; }
  }
}`);
const badAudit = evaluateSpriteQuality(badSprite);
assert.equal(badAudit.passed, false);
assert.ok(badAudit.hardGates.some((g) => g.id === 'no_crushed_blacks' && !g.passed));
assert.match(formatSpriteGateFailure('bad_box', badAudit), /failed quality gate/);

console.log(
  `sprite audit calibration ok: item=${itemAudit.score} tile=${tileAudit.score} bad=${badAudit.score}`,
);
