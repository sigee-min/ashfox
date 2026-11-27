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
const craftedItem = compileFromSource(`ashfox 1
sprite potion {
  export material glass { ramp { mode = auto; base = #5ea9dc; preset = gem; } }
  export material liquid { ramp { mode = auto; base = #d9466b; preset = vivid; } }
  export material cork { ramp { mode = auto; base = #9b6b43; preset = wood; } }
  profile = item;
  canvas = (32px, 32px);
  palette { glint = #ffffff; }
  ellipse body {
    cx = 15px; cy = 18px; rx = 9px; ry = 8px;
    material = glass;
    shade { form = round; light = top_left; contrast = 2; specular = 2; }
  }
  ellipse elixir {
    cx = 15px; cy = 20px; rx = 7px; ry = 5px;
    material = liquid;
    shade { form = round; light = top_left; contrast = 2; specular = 1; }
    grain soft { amount = 1; seed = 5; }
  }
  rect neck {
    x = 13px; y = 7px; width = 6px; height = 5px;
    material = glass;
    shade { form = cylinder; light = top_left; contrast = 2; axis = [(16px, 7px), (16px, 12px)]; }
  }
  rect stopper {
    x = 13px; y = 4px; width = 6px; height = 3px;
    material = cork;
    shade { form = bevel; light = top_left; contrast = 2; axis = [(13px, 6px), (18px, 4px)]; }
  }
  paint spec { at = (11px, 14px); rows = ["gg", "g."]; colors { g = glint; } }
  outline edge { mode = sel_out; strength = 2; inner_rim = true; }
}`);
const itemAudit = evaluateSpriteQuality(craftedItem);
assert.equal(itemAudit.passed, true, formatSpriteGateFailure('potion', itemAudit));
assert.ok(itemAudit.score >= 85, `expected >= 85, got ${itemAudit.score}`);
const itemSheet = Buffer.from(spriteInspectSheetPng(craftedItem, itemAudit));
assert.equal(itemSheet.readUInt32BE(16), 512);
assert.equal(itemSheet.readUInt32BE(20), 512);

// 2. Seamless 32x32 stone tile passes >= 85 and produces 512x512 tile inspect sheet.
const craftedTile = compileFromSource(`ashfox 1
sprite stone_tile {
  export material stone { ramp { mode = auto; base = #727982; preset = stone; } }
  export material mortar { ramp { mode = auto; base = #50565f; preset = stone; } }
  export material moss { ramp { mode = auto; base = #5c8a47; preset = organic; } }
  profile = tile;
  canvas = (32px, 32px);
  palette {}
  fill blocks {
    material = stone;
    pattern brick { width = 16px; height = 8px; mortar = 1px; stagger = 8px; seed = 42; mortar_material = mortar; }
    grain clustered { amount = 1; seed = 19; }
  }
  pattern lichen {
    material = stone;
    pattern blotch { scale = 4px; density = 0.25; seed = 88; to_material = moss; }
    clip = canvas;
  }
}`);
const tileAudit = evaluateSpriteQuality(craftedTile);
assert.equal(tileAudit.passed, true, formatSpriteGateFailure('stone_tile', tileAudit));
assert.ok(tileAudit.score >= 85, `expected tile >= 85, got ${tileAudit.score}`);
const tileSheet = Buffer.from(spriteInspectSheetPng(craftedTile, tileAudit));
assert.equal(tileSheet.readUInt32BE(16), 512);

// 3. Flat crushed-black single square fails hard gates & quality threshold.
const badSprite = compileFromSource(`ashfox 1
sprite bad_box {
  export material pitch { ramp { mode = explicit; colors = [#050505, #080808, #0c0c0c]; } }
  profile = item;
  canvas = (16px, 16px);
  palette {}
  rect box {
    x = 4px; y = 4px; width = 8px; height = 8px;
    material = pitch;
    shade { form = flat; light = top_left; contrast = 0; }
  }
}`);
const badAudit = evaluateSpriteQuality(badSprite);
assert.equal(badAudit.passed, false);
assert.ok(badAudit.hardGates.some((g) => g.id === 'no_crushed_blacks' && !g.passed));
assert.match(formatSpriteGateFailure('bad_box', badAudit), /failed quality gate/);

// 4. ui_9slice profile with slice margins, clean stretch center, and nineSlice receipt.
const uiPanel = compileFromSource(`ashfox 1
sprite ui_panel {
  export material slate { ramp { mode = auto; base = #3d4d63; preset = cool; } }
  export material bezel { ramp { mode = auto; base = #667c99; preset = metal; } }
  export material accent { ramp { mode = auto; base = #4ed3e8; preset = emissive; } }
  profile = ui_9slice;
  canvas = (32px, 32px);
  slice = (6px, 6px, 6px, 6px);
  palette { corner = #7aefff; }
  rect outer {
    x = 1px; y = 1px; width = 30px; height = 30px;
    material = bezel;
    shade { form = bevel; light = top_left; contrast = 2; axis = [(1px, 1px), (30px, 30px)]; }
  }
  rect inner {
    x = 4px; y = 4px; width = 24px; height = 24px;
    material = slate;
    shade { form = flat; light = top_left; contrast = 0; }
  }
  rect trim {
    x = 3px; y = 3px; width = 26px; height = 2px;
    material = accent;
    shade { form = flat; light = top_left; contrast = 0; }
  }
  paint rivets { at = (2px, 2px); rows = ["cc", "cc"]; colors { c = corner; } }
  outline edge { mode = sel_out; strength = 2; inner_rim = true; }
}`);
assert.deepEqual(uiPanel.nineSlice, { left: 6, right: 6, top: 6, bottom: 6 });
const uiAudit = evaluateSpriteQuality(uiPanel);
assert.equal(uiAudit.passed, true, formatSpriteGateFailure('ui_panel', uiAudit));
assert.ok(uiAudit.score >= 85, `expected ui_9slice >= 85, got ${uiAudit.score}`);

// 5. crosshair profile with symmetric high-contrast reticle vs asymmetric failure.
const crosshairGood = compileFromSource(`ashfox 1
sprite reticle {
  export material core { ramp { mode = auto; base = #e8eef5; preset = cool; } }
  export material glow { ramp { mode = auto; base = #5ee8f5; preset = emissive; } }
  export material rim { ramp { mode = auto; base = #3b424d; preset = metal; } }
  profile = crosshair;
  canvas = (32px, 32px);
  palette { pip = #ffffff; }
  rect bracket_v { x = 6px; y = 6px; width = 2px; height = 4px; material = rim; shade { form = bevel; light = top_left; contrast = 2; axis = [(6px, 6px), (7px, 9px)]; } mirror = xy; }
  rect top_arm { x = 15px; y = 4px; width = 2px; height = 7px; material = glow; shade { form = bevel; light = top_left; contrast = 2; axis = [(15px, 4px), (16px, 10px)]; } mirror = y; }
  rect left_arm { x = 4px; y = 15px; width = 7px; height = 2px; material = core; shade { form = bevel; light = top_left; contrast = 2; axis = [(4px, 15px), (10px, 16px)]; } mirror = x; }
  paint dot { at = (15px, 15px); rows = ["pp", "pp"]; colors { p = pip; } }
  outline edge { mode = dark; strength = 2; inner_rim = true; }
}`);
const crosshairAudit = evaluateSpriteQuality(crosshairGood);
assert.equal(crosshairAudit.passed, true, formatSpriteGateFailure('reticle', crosshairAudit));
assert.ok(crosshairAudit.score >= 85, `expected crosshair >= 85, got ${crosshairAudit.score}`);

const crosshairBad = compileFromSource(`ashfox 1
sprite skewed_reticle {
  export material core { ramp { mode = auto; base = #e8eef5; preset = cool; } }
  profile = crosshair;
  canvas = (32px, 32px);
  palette {}
  rect off_arm { x = 3px; y = 3px; width = 8px; height = 4px; material = core; shade { form = flat; light = top_left; contrast = 0; } }
}`);
const crosshairBadAudit = evaluateSpriteQuality(crosshairBad);
assert.equal(crosshairBadAudit.passed, false);
assert.ok(crosshairBadAudit.hardGates.some((g) => g.id === 'crosshair_symmetry' && !g.passed));

// 6. hud_bar profile with frame + fill separation vs flat bar failure.
const hudBarGood = compileFromSource(`ashfox 1
sprite hp_bar {
  export material frame { ramp { mode = auto; base = #596575; preset = metal; } }
  export material fill_ruby { ramp { mode = auto; base = #d94158; preset = vivid; } }
  export material trim { ramp { mode = auto; base = #e8b642; preset = warm; } }
  profile = hud_bar;
  canvas = (32px, 32px);
  palette { tick = #fff4d6; }
  rect outer { x = 2px; y = 9px; width = 28px; height = 14px; material = frame; shade { form = bevel; light = top_left; contrast = 2; axis = [(2px, 9px), (29px, 22px)]; } }
  rect inner { x = 5px; y = 12px; width = 22px; height = 8px; material = fill_ruby; shade { form = round; light = top; contrast = 2; specular = 1; } }
  rect pip_a { x = 15px; y = 12px; width = 2px; height = 8px; material = trim; shade { form = flat; light = top_left; contrast = 1; } }
  paint spec { at = (6px, 13px); rows = ["ttt", "t.."]; colors { t = tick; } }
  outline edge { mode = sel_out; strength = 2; inner_rim = true; }
}`);
const hudAudit = evaluateSpriteQuality(hudBarGood);
assert.equal(hudAudit.passed, true, formatSpriteGateFailure('hp_bar', hudAudit));
assert.ok(hudAudit.score >= 85, `expected hud_bar >= 85, got ${hudAudit.score}`);

// 7. decal profile with 8-bit soft alpha and zero border clipping.
const decalGood = compileFromSource(`ashfox 1
sprite scorch_decal {
  export material soot { ramp { mode = auto; base = #59504d; preset = stone; } }
  export material ember { ramp { mode = auto; base = #d4652f; preset = warm; } }
  export material ash { ramp { mode = auto; base = #8a7f7a; preset = warm; } }
  profile = decal;
  canvas = (32px, 32px);
  palette { fade = #59504d66; }
  ellipse base_scorch {
    cx = 15.5px; cy = 15.5px; rx = 11px; ry = 10px;
    material = soot;
    shade { form = round; light = top_left; contrast = 2; }
    pattern blotch { scale = 4px; density = 0.35; seed = 17; to_material = ash; }
    feather = 4px;
    alpha = 0.92;
  }
  ellipse hot_core {
    cx = 15.5px; cy = 15.5px; rx = 5px; ry = 4px;
    material = ember;
    shade { form = round; light = top_left; contrast = 2; specular = 1; }
    feather = 2px;
  }
  paint wisp { at = (9px, 14px); rows = ["ff", "ff"]; colors { f = fade; } }
}`);
const decalAudit = evaluateSpriteQuality(decalGood);
assert.equal(decalAudit.passed, true, formatSpriteGateFailure('scorch_decal', decalAudit));
assert.ok(decalAudit.score >= 85, `expected decal >= 85, got ${decalAudit.score}`);

const decalClipped = compileFromSource(`ashfox 1
sprite clipped_decal {
  export material soot { ramp { mode = auto; base = #59504d; preset = stone; } }
  profile = decal;
  canvas = (16px, 16px);
  palette {}
  rect full { x = 0px; y = 0px; width = 16px; height = 16px; material = soot; shade { form = flat; light = top_left; contrast = 0; } }
}`);
const decalClipAudit = evaluateSpriteQuality(decalClipped);
assert.equal(decalClipAudit.passed, false);
assert.ok(decalClipAudit.hardGates.some((g) => g.id === 'decal_no_border_clip' && !g.passed));
assert.ok(decalClipAudit.hardGates.some((g) => g.id === 'decal_soft_alpha' && !g.passed));

console.log(
  `sprite audit calibration ok: item=${itemAudit.score} tile=${tileAudit.score} ui=${uiAudit.score} crosshair=${crosshairAudit.score} hud=${hudAudit.score} decal=${decalAudit.score} bad=${badAudit.score}`,
);
