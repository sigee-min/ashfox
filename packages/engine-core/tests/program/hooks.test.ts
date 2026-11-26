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

const gameWorldSource = `ashfox 1
module game_world {
  export schema LootSpawn : anchor {
    field tier : enum(common, rare, epic) = common;
    field chance : float(0..1) = 0.65;
    field count : int(1..8) = 1;
    field enabled : bool = true;
    field offset : vec2 = (0, 0);
    field spread : vec3 = (1, 0, 1);
    field respawn : second = 120s;
    field table : string;
    field prefab? : asset;
    mc_block = "minecraft:chest[facing=\${facing}]";
  }
  export schema StormShelter : volume {
    field shield_ratio : float(0..1) = 1.0;
    field label : string;
  }
  export schema MeleeHitbox : cue {
    field arc_deg : deg(10..360) = 110deg;
    field radius : unit = 14u;
    field damage : number = 20;
    field sfx : string;
  }
  export schema AiHearing : meta {
    field radius : float(0..120);
    field alert_level : enum(low, medium, high) = medium;
  }
}`;

const parsedRules = parseHooksSource(gameWorldSource, 'modules/game_world.ashfox');
assert.equal(parsedRules.ok, true, JSON.stringify(parsedRules.diagnostics));
assert.equal(parsedRules.unit.header, 'ashfox 1');
assert.equal(parsedRules.unit.unitKind, 'module');
assert.equal(parsedRules.unit.schemas.length, 4);
assert.equal(parsedRules.unit.schemas[0]?.id, 'game_world.LootSpawn');
assert.equal(parsedRules.unit.schemas[0]?.exported, true);
assert.equal(parsedRules.unit.schemas[0]?.inline, false);

const rulesVal = validateHooksUnit(parsedRules.unit);
assert.equal(rulesVal.ok, true, JSON.stringify(rulesVal.diagnostics));

const tavernSource = `ashfox 1
structure tavern {
  import "../modules/game_world.ashfox" as game;
  import "../models/props/loot_chest.ashfox" as chest_prop;

  density = 2; seed = 404; size = (19b, 22b, 17b);
  floor ground {
    y = 0b; height = 5b;
    room bedroom {
      from = (1b, 1b); size = (8b, 8b); kind = bedroom;
      anchor attic_loot : game.LootSpawn {
        at = (11b, 5b, 2b);
        facing = south;
        tier = epic;
        chance = 0.45;
        table = "br:attic_weapons";
        prefab = chest_prop;
      }
    }
    room taproom {
      from = (1b, 1b); size = (15b, 9b); kind = tavern;
      volume main_shelter : game.StormShelter {
        from = (0b, 0b, 0b);
        size = (10b, 4b, 8b);
        enclosure = enclosed;
        shield_ratio = 0.85;
        label = "Tavern Ground";
      }
    }
  }
  zone courtyard_zone : std.courtyard {
    from = (10b, 0b, 0b);
    to = (18b, 4b, 8b);
    enclosure = semi_open;
    shape = rect;
    pool = "yard";
  }
  mc_block attic_loot = "minecraft:trapped_chest[facing=south]";
}`;

const parsedTavern = parseHooksSource(tavernSource, 'structures/tavern.ashfox', {
  allowHostStatements: true,
});
assert.equal(parsedTavern.ok, true, JSON.stringify(parsedTavern.diagnostics));

const importedUnits: Record<string, HookSourceUnit> = {
  '../modules/game_world.ashfox': parsedRules.unit,
};
const tavernVal = validateHooksUnit(parsedTavern.unit, {
  importedUnits,
  validParentIds: { rooms: ['bedroom', 'taproom'] },
});
assert.equal(tavernVal.ok, true, JSON.stringify(tavernVal.diagnostics));
assert.equal(tavernVal.document.anchors.length, 1);
const attic = tavernVal.document.anchors[0]!;
assert.equal(attic.schema, 'game_world.LootSpawn');
assert.equal(attic.room, 'bedroom');
assert.deepEqual(attic.normal, [0, 0, 1]);
assert.equal(attic.mcBlock, 'minecraft:trapped_chest[facing=south]');
assert.equal(attic.props.count, 1);
assert.equal(attic.props.enabled, true);
assert.equal(attic.props.respawn, 120);
assert.deepEqual(attic.props.offset, [0, 0]);
assert.deepEqual(tavernVal.document.volumes[0]?.max, [10, 4, 8]);
assert.equal(tavernVal.document.zones[0]?.enclosure.kind, 'semi_open');
assert.equal(tavernVal.document.zones[0]?.enclosure.enclosed, false);

// Schema mc_block template interpolation (`${facing}`) when not overridden.
const tplSource = `ashfox 1
structure camp {
  import "../modules/game_world.ashfox" as game;
  anchor camp_loot : game.LootSpawn {
    at = (2b, 0b, 3b);
    facing = east;
    tier = rare;
    table = "br:camp";
  }
}`;
const tplVal = validateHooksUnit(parseHooksSource(tplSource, 'camp.ashfox').unit, {
  importedUnits,
});
assert.equal(tplVal.ok, true, JSON.stringify(tplVal.diagnostics));
assert.equal(tplVal.document.anchors[0]?.mcBlock, 'minecraft:chest[facing=east]');

// Determinism check.
const tavernVal2 = validateHooksUnit(parsedTavern.unit, {
  importedUnits,
  validParentIds: { rooms: ['bedroom', 'taproom'] },
});
assert.equal(JSON.stringify(tavernVal.document), JSON.stringify(tavernVal2.document));

// Cue range (`..`), meta, 2D sprite hooks, and top-level export schema.
const goblinAndSound = `ashfox 1
export schema custom.Tag : anchor | meta {
  field rank : int(1..5) = 2;
}
anchor muzzle : custom.Tag { bone = hand_right; at = (4px, 8px); }
cue swing_window : game.MeleeHitbox {
  clip = attack;
  at = 180ms..0.34s;
  arc_deg = 120deg;
  damage = 28;
  sfx = "sword_slash";
}
meta hearing : game.AiHearing {
  target = sword_slash;
  radius = 22.0;
  alert_level = high;
}`;
const parsedMixed = parseHooksSource(goblinAndSound, 'actors/goblin.ashfox');
assert.equal(parsedMixed.ok, true, JSON.stringify(parsedMixed.diagnostics));
const mixedVal = validateHooksUnit(parsedMixed.unit, {
  schemas: parsedRules.unit.schemas.map((s) => ({ ...s, id: `game.${s.name}` })),
});
assert.equal(mixedVal.ok, true, JSON.stringify(mixedVal.diagnostics));
assert.equal(mixedVal.document.anchors[0]?.space, '2d');
assert.equal(mixedVal.document.anchors[0]?.bone, 'hand_right');
assert.equal(mixedVal.document.cues[0]?.from, 0.18);
assert.equal(mixedVal.document.cues[0]?.to, 0.34);
assert.equal(mixedVal.document.meta[0]?.props.alert_level, 'high');

// Inline schema detection + legacy header rejection.
const hostSource = `ashfox 1
structure hut {
  palette { stone = "minecraft:stone"; }
  schema LocalOnly : anchor { field tag : string; }
  anchor door : std.entry { at = (1b, 0b, 0b); facing = north; width = 2; }
}`;
const parsedHost = parseHooksSource(hostSource, 'hut.ashfox', { allowHostStatements: true });
assert.equal(parsedHost.ok, true, JSON.stringify(parsedHost.diagnostics));
assert.equal(parsedHost.unit.schemas[0]?.inline, true);
assert.equal(parsedHost.unit.schemas[0]?.exported, false);

const legacyHeader = parseHooksSource(`ashfox${'-model'} 1\nmodule legacy {}`, 'legacy.ashfox');
assert.equal(legacyHeader.ok, false);
assert.equal(legacyHeader.diagnostics[0]?.code, 'hooks.legacy-header-forbidden');

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
    `ashfox 1
    anchor front_door : std.entry { at = (0b, 0b, 0b); facing = north; }
    anchor east_road : std.road { at = (5b, 0b, 0b); facing = east; }
    anchor seam : std.wall_join { at = (0b, 0b, 5b); }
    anchor seat_1 : std.sit { at = (2b, 0b, 2b); pose = bench; }
    anchor hinge_1 : std.door_hinge { at = (0b, 0b, 0b); side = right; swing_deg = 110deg; }
    volume body_box : std.hitbox { from = (-1u, 0u, -1u); to = (1u, 2u, 1u); role = hurtbox; }
    cue footstep : std.sfx { clip = walk; at = 0.2s; sound = "stone_step"; }
  `,
    'std_use.ashfox',
  ).unit,
);
assert.equal(stdUsage.ok, true, JSON.stringify(stdUsage.diagnostics));
assert.equal(stdUsage.document.anchors.find((a) => a.id === 'seat_1')?.props.height_offset, 0.5);

// Closed validation failures with source-owned diagnostics (including quoted enum rejection).
const badSource = `ashfox 1
import "../modules/game_world.ashfox" as game;
import "../modules/game_world.ashfox" as game;
anchor bad_1 : game.LootSpawn {
  room = missing_room;
  at = (0b, 0b, 0b);
  tier = mythic;
  chance = 1.5;
  count = 1.5;
  respawn = 12deg;
  unknown_key = 123;
  prefab = "has spaces";
}
anchor bad_1 : game.StormShelter { at = (0b, 0b, 0b); label = "wrong target"; }
anchor bad_enum : game.LootSpawn { tier = "epic"; table = "t"; }
volume bad_vol : game.StormShelter { from = (5b, 0b, 0b); to = (1b, 2b, 2b); }
cue bad_cue : game.MeleeHitbox { at = 0.1s; from = 0.2s; to = 0.1s; frame = 1.5; sfx = "hit"; }
mc_block missing_target = "BAD_STATE";`;
const badParsed = parseHooksSource(badSource, 'bad.ashfox');
assert.equal(badParsed.ok, true, JSON.stringify(badParsed.diagnostics));
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
  'hooks.invalid-property-unit',
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
const cycA = parseHooksSource('ashfox 1\nimport "b.ashfox" as b;', 'a.ashfox').unit;
const cycB = parseHooksSource('ashfox 1\nimport "a.ashfox" as a;', 'b.ashfox').unit;
const cycRes = validateHooksUnit(cycA, { importedUnits: { 'b.ashfox': cycB, 'a.ashfox': cycA } });
assert.equal(cycRes.ok, false);
assert.ok(cycRes.diagnostics.some((d) => d.code === 'hooks.import-cycle'));
assert.equal(isValidAssetReference('models/chest.ashfox'), true);
assert.equal(isValidAssetReference('bad ref with spaces'), false);

// Syntax error recovery preserves line/column/token.
const synErr = parseHooksSource('ashfox 1\nanchor broken : { }', 'broken.ashfox');
assert.equal(synErr.ok, false);
assert.equal(synErr.diagnostics[0]?.file, 'broken.ashfox');
assert.equal(synErr.diagnostics[0]?.line, 2);

// Transform propagation: bone hierarchy, room/floor, compound_place 90 deg, rotate 45 deg, mirror.
const xformUnit = parseHooksSource(
  `ashfox 1
  anchor hand_tip : std.entry { bone = hand; at = (1u, 0u, 0u); facing = north; }
  anchor room_loot : std.sit { room = hall; at = (2b, 1b, 3b); facing = north; }
  volume hit : std.hitbox { bone = hand; from = (0u, 0u, 0u); to = (2u, 2u, 4u); }
  zone hall_zone { enclosure = enclosed; from = (0b, 0b, 0b); to = (4b, 3b, 6b); }
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

const rotOut = propagateHooksTransforms(xformDoc, {
  postTransforms: [
    { kind: 'rotate', degrees: [0, 45, 0] },
    { kind: 'mirror', axis: 'x', center: 0 },
  ],
});
const hitVol = rotOut.volumes[0]!;
assert.ok(hitVol.max[0] - hitVol.min[0] > 4);
assert.deepEqual(hitVol.obb.halfExtents, [1, 1, 2]);

const cycles = detectTransformCycles({
  bones: {
    a: { id: 'a', parentId: 'b', translation: [0, 0, 0] },
    b: { id: 'b', parentId: 'a', translation: [0, 0, 0] },
  },
});
assert.deepEqual(cycles, ['bone:a', 'bone:b']);
