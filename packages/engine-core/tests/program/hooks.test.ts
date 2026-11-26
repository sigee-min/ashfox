import assert from 'node:assert/strict';
import {
  STD_SCHEMAS,
  detectTransformCycles,
  getStdSchema,
  isValidAssetReference,
  parseHooksSource,
  propagateHooksTransforms,
  validateHooksUnit,
  type HookSourceUnit,
} from '../../src/hooks/index';

const brRulesSource = `ashfox-model 1
module br_rules {
  export schema loot_spot on anchor {
    tier: "common" | "rare" | "epic" = "common";
    chance: float(0..1) = 0.65;
    count: int(1..8) = 1;
    enabled: bool = true;
    offset: vec2 = (0, 0);
    spread: vec3 = (1, 0, 1);
    table: string;
    prefab?: asset;
    mc_block?: string;
  }
  export schema storm_shelter on volume {
    shield_ratio: float(0..1) = 1.0;
    label: string;
  }
  export schema melee_hit on cue {
    arc_deg: float(10..360) = 110;
    damage_mult: float(0.1..10) = 1.0;
    sfx: string;
  }
  export schema ai_hearing on meta {
    radius: float(0..120);
    alert_level: "low" | "medium" | "high" = "medium";
  }
}`;

const parsedRules = parseHooksSource(brRulesSource, 'modules/br_rules.ashfox');
assert.equal(parsedRules.ok, true, JSON.stringify(parsedRules.diagnostics));
assert.equal(parsedRules.unit.unitKind, 'module');
assert.equal(parsedRules.unit.schemas.length, 4);
assert.equal(parsedRules.unit.schemas[0]?.id, 'br_rules.loot_spot');
assert.equal(parsedRules.unit.schemas[0]?.exported, true);
assert.equal(parsedRules.unit.schemas[0]?.inline, false);

const rulesVal = validateHooksUnit(parsedRules.unit);
assert.equal(rulesVal.ok, true, JSON.stringify(rulesVal.diagnostics));

const tavernSource = `ashfox-model 1
import "../modules/br_rules.ashfox" as br;
import "../models/props/loot_chest.ashfox" as chest_prop;
structure tavern {
  anchor attic_loot as br.loot_spot room = bedroom at = (11, 5, 2) facing = south {
    tier = "epic";
    chance = 0.45;
    table = "br:attic_weapons";
    prefab = chest_prop;
    mc_block = "minecraft:chest[facing=south]";
  }
  volume main_shelter as br.storm_shelter room = taproom from = (0, 0, 0) to = (10, 4, 8) enclosure = enclosed {
    shield_ratio = 0.85;
    label = "Tavern Ground";
  }
  zone courtyard_zone as std.courtyard from = (10, 0, 0) to = (18, 4, 8) enclosure = semi_open shape = rect {
    pool = "yard";
  }
  mc_block attic_loot = "minecraft:trapped_chest[facing=south]";
}`;

const parsedTavern = parseHooksSource(tavernSource, 'structures/tavern.ashfox');
assert.equal(parsedTavern.ok, true, JSON.stringify(parsedTavern.diagnostics));

const importedUnits: Record<string, HookSourceUnit> = {
  '../modules/br_rules.ashfox': parsedRules.unit,
};
const tavernVal = validateHooksUnit(parsedTavern.unit, {
  importedUnits,
  validParentIds: { rooms: ['bedroom', 'taproom'] },
});
assert.equal(tavernVal.ok, true, JSON.stringify(tavernVal.diagnostics));
assert.equal(tavernVal.document.anchors.length, 1);
const attic = tavernVal.document.anchors[0]!;
assert.equal(attic.schema, 'br_rules.loot_spot');
assert.equal(attic.room, 'bedroom');
assert.deepEqual(attic.normal, [0, 0, 1]);
assert.equal(attic.mcBlock, 'minecraft:trapped_chest[facing=south]');
assert.equal(attic.props.count, 1);
assert.equal(attic.props.enabled, true);
assert.deepEqual(attic.props.offset, [0, 0]);
assert.equal(tavernVal.document.zones[0]?.enclosure.kind, 'semi_open');
assert.equal(tavernVal.document.zones[0]?.enclosure.enclosed, false);

// Determinism check.
const tavernVal2 = validateHooksUnit(parsedTavern.unit, {
  importedUnits,
  validParentIds: { rooms: ['bedroom', 'taproom'] },
});
assert.equal(JSON.stringify(tavernVal.document), JSON.stringify(tavernVal2.document));

// Cue, meta, 2D sprite hooks, and top-level export schema <ns.name>.
const goblinAndSound = `
export schema custom.tag on anchor | meta {
  rank: int(1..5) = 2;
}
anchor muzzle as custom.tag bone = hand_right at = (4, 8) {}
cue swing_window as br.melee_hit clip = attack from = 0.18s to = 0.34s {
  arc_deg = 120;
  damage_mult = 1.4;
  sfx = "sword_slash";
}
meta hearing as br.ai_hearing target = sword_slash {
  radius = 22.0;
  alert_level = "high";
}`;
const parsedMixed = parseHooksSource(goblinAndSound, 'actors/goblin.ashfox');
assert.equal(parsedMixed.ok, true, JSON.stringify(parsedMixed.diagnostics));
const mixedVal = validateHooksUnit(parsedMixed.unit, {
  schemas: parsedRules.unit.schemas.map((s) => ({ ...s, id: `br.${s.name}` })),
});
assert.equal(mixedVal.ok, true, JSON.stringify(mixedVal.diagnostics));
assert.equal(mixedVal.document.anchors[0]?.space, '2d');
assert.equal(mixedVal.document.anchors[0]?.bone, 'hand_right');
assert.equal(mixedVal.document.cues[0]?.from, 0.18);
assert.equal(mixedVal.document.cues[0]?.to, 0.34);
assert.equal(mixedVal.document.meta[0]?.props.alert_level, 'high');

// Inline schema detection flag + host-statement skipping mode.
const hostSource = `ashfox-model 1
structure hut {
  palette { stone = "minecraft:stone"; }
  schema local_only on anchor { tag: string; }
  anchor door as std.entry at = (1, 0, 0) facing = north { width = 2; }
}`;
const parsedHost = parseHooksSource(hostSource, 'hut.ashfox', { allowHostStatements: true });
assert.equal(parsedHost.ok, true, JSON.stringify(parsedHost.diagnostics));
assert.equal(parsedHost.unit.schemas[0]?.inline, true);
assert.equal(parsedHost.unit.schemas[0]?.exported, false);

// Standard library schemas.
assert.equal(STD_SCHEMAS.length, 8);
for (const id of [
  'std.entry',
  'std.road',
  'std.wall_join',
  'std.courtyard',
  'std.sit',
  'std.door_hinge',
  'std.hitbox',
  'std.sfx',
]) {
  assert.ok(getStdSchema(id), `Missing std schema ${id}`);
}
const stdUsage = validateHooksUnit(
  parseHooksSource(
    `
    anchor front_door as std.entry at = (0, 0, 0) facing = north {}
    anchor east_road as std.road at = (5, 0, 0) facing = east {}
    anchor seam as std.wall_join at = (0, 0, 5) {}
    anchor seat_1 as std.sit at = (2, 0, 2) { pose = "bench"; }
    anchor hinge_1 as std.door_hinge at = (0, 0, 0) { side = "right"; swing_deg = 110; }
    volume body_box as std.hitbox from = (-1, 0, -1) to = (1, 2, 1) { role = "hurtbox"; }
    cue footstep as std.sfx clip = walk at = 0.2s { sound = "stone_step"; }
  `,
    'std_use.ashfox',
  ).unit,
);
assert.equal(stdUsage.ok, true, JSON.stringify(stdUsage.diagnostics));
assert.equal(stdUsage.document.anchors.find((a) => a.id === 'seat_1')?.props.height_offset, 0.5);

// Closed validation failures with source-owned diagnostics.
const badSource = `
import "../modules/br_rules.ashfox" as br;
import "../modules/br_rules.ashfox" as br;
anchor bad_1 as br.loot_spot room = missing_room at = (0, 0, 0) {
  tier = "mythic";
  chance = 1.5;
  count = 1.5;
  unknown_key = 123;
  prefab = "has spaces";
}
anchor bad_1 as br.storm_shelter at = (0, 0, 0) { label = "wrong target"; }
volume bad_vol as br.storm_shelter from = (5, 0, 0) to = (1, 2, 2) {}
cue bad_cue as br.melee_hit at = 0.1s from = 0.2s to = 0.1s frame = 1.5 { sfx = "hit"; }
mc_block missing_target = "BAD_STATE";`;
const badParsed = parseHooksSource(badSource, 'bad.ashfox');
assert.equal(badParsed.ok, true);
const badVal = validateHooksUnit(badParsed.unit, {
  importedUnits,
  validParentIds: { rooms: ['taproom'] },
});
assert.equal(badVal.ok, false);
const codes = new Set(badVal.diagnostics.map((d) => d.code));
for (const expected of [
  'hooks.duplicate-import',
  'hooks.unknown-parent',
  'hooks.invalid-union-value',
  'hooks.out-of-range',
  'hooks.invalid-property-type',
  'hooks.unknown-property',
  'hooks.invalid-asset-ref',
  'hooks.missing-required-property',
  'hooks.duplicate-id',
  'hooks.schema-target-mismatch',
  'hooks.invalid-volume-bounds',
  'hooks.invalid-cue-timing',
  'hooks.unknown-mc-block-target',
  'hooks.invalid-mc-block',
]) {
  assert.ok(codes.has(expected), `Expected diagnostic ${expected}, got ${[...codes].join(', ')}`);
}
assert.ok(badVal.diagnostics.every((d) => d.file === 'bad.ashfox' && d.line > 0 && d.column > 0));

// Import cycle detection + asset syntax helper.
const cycA = parseHooksSource('import "b.ashfox" as b;', 'a.ashfox').unit;
const cycB = parseHooksSource('import "a.ashfox" as a;', 'b.ashfox').unit;
const cycRes = validateHooksUnit(cycA, { importedUnits: { 'b.ashfox': cycB, 'a.ashfox': cycA } });
assert.equal(cycRes.ok, false);
assert.ok(cycRes.diagnostics.some((d) => d.code === 'hooks.import-cycle'));
assert.equal(isValidAssetReference('models/chest.ashfox'), true);
assert.equal(isValidAssetReference('bad ref with spaces'), false);

// Syntax error recovery preserves line/column/token.
const synErr = parseHooksSource('anchor broken as { }', 'broken.ashfox');
assert.equal(synErr.ok, false);
assert.equal(synErr.diagnostics[0]?.file, 'broken.ashfox');
assert.equal(synErr.diagnostics[0]?.line, 1);

// Transform propagation: bone hierarchy, room/floor, compound_place 90 deg, rotate 45 deg, mirror.
const xformUnit = parseHooksSource(
  `
  anchor hand_tip as std.entry bone = hand at = (1, 0, 0) facing = north {}
  anchor room_loot as std.sit room = hall at = (2, 1, 3) facing = north {}
  volume hit as std.hitbox bone = hand from = (0, 0, 0) to = (2, 2, 4) {}
  zone hall_zone enclosure = enclosed from = (0, 0, 0) to = (4, 3, 6) {}
`,
  'xform.ashfox',
).unit;
const xformDoc = validateHooksUnit(xformUnit).document;

const boneOut = propagateHooksTransforms(xformDoc, {
  bones: {
    arm: { id: 'arm', translation: [0, 10, 0], rotation: [0, 90, 0] },
    hand: { id: 'hand', parentId: 'arm', translation: [2, 0, 0] },
  },
  floors: { ground: { id: 'ground', y: 4, height: 4 } },
  rooms: { hall: { id: 'hall', parentId: 'ground', min: [10, 0, 20], max: [18, 4, 28] } },
});
const handTip = boneOut.anchors.find((a) => a.id === 'hand_tip')!;
assert.deepEqual(handTip.position, [0, 10, -3]);
assert.deepEqual(handTip.normal, [-1, 0, 0]);
const roomLoot = boneOut.anchors.find((a) => a.id === 'room_loot')!;
assert.deepEqual(roomLoot.position, [12, 5, 23]);

// Compound 90° clockwise placement with childSize [10, 8, 12] at origin [100, 0, 200] + mirror X.
const compoundOut = propagateHooksTransforms(xformDoc, {
  postTransforms: [
    {
      kind: 'compound_place',
      alias: 'wing',
      origin: [100, 0, 200],
      rotate: 90,
      childSize: [10, 8, 12],
    },
  ],
});
const hallZone = compoundOut.zones[0]!;
assert.deepEqual(hallZone.min, [106, 0, 200]);
assert.deepEqual(hallZone.max, [112, 3, 204]);

// 45° rotated volume produces tight AABB around OBB + mirror flips normal.
const rotOut = propagateHooksTransforms(xformDoc, {
  postTransforms: [
    { kind: 'rotate', degrees: [0, 45, 0] },
    { kind: 'mirror', axis: 'x', center: 0 },
  ],
});
const hitVol = rotOut.volumes[0]!;
assert.ok(hitVol.max[0] - hitVol.min[0] > 4);
assert.deepEqual(hitVol.obb.halfExtents, [1, 1, 2]);

// Cycle detection in transform context.
const cycles = detectTransformCycles({
  bones: {
    a: { id: 'a', parentId: 'b', translation: [0, 0, 0] },
    b: { id: 'b', parentId: 'a', translation: [0, 0, 0] },
  },
});
assert.deepEqual(cycles, ['bone:a', 'bone:b']);
