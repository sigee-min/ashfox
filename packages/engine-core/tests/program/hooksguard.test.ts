import assert from 'node:assert/strict';
import type { HookSchemaDecl, HookSourceSpan, HooksDocument } from '../../src/hooks/contract';
import {
  generateAllHookBindings,
  generateBindingsFromDocument,
  generateHookBindings,
} from '../../src/hooks/bindings';
import { checkWorkspaceModularity } from '../../src/hooks/modularityGuard';

const span = (file: string, line = 1): HookSourceSpan => ({
  file,
  start: { offset: 0, line, column: 1 },
  end: { offset: 1, line, column: 2 },
});

const BR_SCHEMAS: readonly HookSchemaDecl[] = [
  {
    id: 'game_world.LootSpawn',
    namespace: 'game_world',
    name: 'LootSpawn',
    exported: true,
    inline: false,
    targets: ['anchor'],
    span: span('modules/game_world.ashfox', 3),
    fields: [
      {
        name: 'tier',
        type: { kind: 'union', values: ['common', 'rare', 'epic'] },
        optional: false,
        defaultValue: {
          kind: 'string',
          value: 'common',
          span: span('modules/game_world.ashfox', 4),
        },
        span: span('modules/game_world.ashfox', 4),
      },
      {
        name: 'chance',
        type: { kind: 'float', min: 0, max: 1 },
        optional: false,
        defaultValue: {
          kind: 'number',
          value: 0.65,
          unit: 'plain',
          span: span('modules/game_world.ashfox', 5),
        },
        span: span('modules/game_world.ashfox', 5),
      },
      {
        name: 'table',
        type: { kind: 'string' },
        optional: false,
        span: span('modules/game_world.ashfox', 6),
      },
      {
        name: 'prefab',
        type: { kind: 'asset' },
        optional: true,
        span: span('modules/game_world.ashfox', 7),
      },
    ],
  },
  {
    id: 'game_world.MeleeHitbox',
    namespace: 'game_world',
    name: 'MeleeHitbox',
    exported: true,
    inline: false,
    targets: ['cue'],
    span: span('modules/game_world.ashfox', 11),
    fields: [
      {
        name: 'priority',
        type: { kind: 'int', min: 1, max: 10 },
        optional: false,
        defaultValue: {
          kind: 'number',
          value: 5,
          unit: 'plain',
          span: span('modules/game_world.ashfox', 12),
        },
        span: span('modules/game_world.ashfox', 12),
      },
      {
        name: 'offset',
        type: { kind: 'vec3' },
        optional: true,
        span: span('modules/game_world.ashfox', 13),
      },
      {
        name: 'event',
        type: { kind: 'bool' },
        optional: false,
        defaultValue: { kind: 'bool', value: true, span: span('modules/game_world.ashfox', 14) },
        span: span('modules/game_world.ashfox', 14),
      },
    ],
  },
];

// 1. Multi-engine bindings codegen (TS / C# / GDScript) + determinism.
{
  const all = generateAllHookBindings(BR_SCHEMAS);
  assert.equal(all.ts.extension, '.d.ts');
  assert.equal(all.cs.extension, '.cs');
  assert.equal(all.gd.extension, '.gd');
  assert.deepEqual(all.ts.schemas, ['game_world.LootSpawn', 'game_world.MeleeHitbox']);

  // TypeScript assertions: literal union, range/default JSDoc, optional, SchemaMap, getHooks.
  assert.match(all.ts.content, /export interface GameWorldLootSpawn/);
  assert.match(all.ts.content, /readonly tier: 'common' \| 'rare' \| 'epic';/);
  assert.match(all.ts.content, /@range float\[0, 1\] @default 0\.65/);
  assert.match(all.ts.content, /readonly prefab\?: AshfoxAssetRef;/);
  assert.match(all.ts.content, /readonly 'game_world\.LootSpawn': GameWorldLootSpawn;/);
  assert.match(all.ts.content, /export declare function getHooks</);

  // Unity C# assertions: enum, [Range], nullable optional, keyword escape, defaults.
  assert.match(all.cs.content, /namespace Ashfox\.Hooks/);
  assert.match(all.cs.content, /public enum GameWorldLootSpawnTier/);
  assert.match(all.cs.content, /Common = 0,\s+Rare = 1,\s+Epic = 2/);
  assert.match(all.cs.content, /\[Range\(0\.0f, 1\.0f\)\]/);
  assert.match(all.cs.content, /public float chance = 0\.65f;/);
  assert.match(all.cs.content, /public string prefab = null;/);
  assert.match(all.cs.content, /\[Range\(1, 10\)\]/);
  assert.match(all.cs.content, /public Vector3\? offset = null;/);
  assert.match(all.cs.content, /public bool @event = true;/);

  // Godot GDScript assertions: enum, @export_range, Variant optional.
  assert.match(all.gd.content, /class_name AshfoxHooks/);
  assert.match(all.gd.content, /class GameWorldLootSpawn:/);
  assert.match(all.gd.content, /enum Tier \{ COMMON, RARE, EPIC \}/);
  assert.match(all.gd.content, /@export_range\(0, 1\)/);
  assert.match(all.gd.content, /@export var chance: float = 0\.65/);
  assert.match(all.gd.content, /var prefab: Variant = null/);
  assert.match(all.gd.content, /@export_range\(1, 10, 1\)/);
  assert.match(all.gd.content, /@export var event: bool = true/);

  // Reversed schema and field order must yield byte-identical bindings.
  const reversedSchemas: readonly HookSchemaDecl[] = [
    { ...BR_SCHEMAS[1]!, fields: [...BR_SCHEMAS[1]!.fields].reverse() },
    { ...BR_SCHEMAS[0]!, fields: [...BR_SCHEMAS[0]!.fields].reverse() },
  ];
  const allReversed = generateAllHookBindings(reversedSchemas);
  assert.equal(allReversed.ts.content, all.ts.content);
  assert.equal(allReversed.cs.content, all.cs.content);
  assert.equal(allReversed.gd.content, all.gd.content);

  const doc: HooksDocument = {
    schemaVersion: 1,
    assetId: 'tavern',
    schemas: BR_SCHEMAS,
    anchors: [],
    volumes: [],
    cues: [],
    meta: [],
    zones: [],
  };
  assert.equal(generateBindingsFromDocument(doc, 'ts').content, all.ts.content);
  assert.match(
    generateHookBindings(BR_SCHEMAS, 'cs', { namespace: 'Game.Hooks' }).content,
    /namespace Game\.Hooks/,
  );
}

// 2. Reject inline schema definitions in ashfox 1 entry files across all domains.
{
  const res = checkWorkspaceModularity([
    {
      path: 'structures/tavern.ashfox',
      source: `ashfox 1
structure tavern {
  floor ground {
    room taproom {
      schema InlineLoot : anchor {
        field tier : enum(common, epic) = common;
      }
    }
  }
  size = (9b, 7b, 9b);
}`,
    },
    {
      path: 'sprites/sword.ashfox',
      source: `ashfox 1
sprite sword {
  schema InlineSpriteMeta : meta {
    field rarity : enum(common, rare) = rare;
  }
}`,
    },
    {
      path: 'sounds/hit.ashfox',
      source: `ashfox 1
sound hit {
  schema InlineSoundCue : cue {
    field tag : string;
  }
}`,
    },
    {
      path: 'vfx/slash.ashfox',
      source: `ashfox 1
vfx slash {
  schema InlineVfxCue : cue {
    field power : float(0..10) = 1.0;
  }
}`,
    },
  ]);
  assert.equal(res.ok, false);
  const inlineDiags = res.diagnostics.filter((d) => d.code === 'hooks.inline-schema-forbidden');
  assert.equal(inlineDiags.length, 4);
  assert.deepEqual(
    inlineDiags.map((d) => d.token),
    [
      'sounds/hit.ashfox#schema:InlineSoundCue',
      'sprites/sword.ashfox#schema:InlineSpriteMeta',
      'structures/tavern.ashfox#schema:InlineLoot',
      'vfx/slash.ashfox#schema:InlineVfxCue',
    ],
  );
}

// 3. Cross-file duplicate boilerplate detection across palette, prefab, voice, and hook blocks.
{
  const res = checkWorkspaceModularity([
    {
      path: 'structures/cottage.ashfox',
      source: `ashfox 1
structure cottage {
  palette {
    cobble = "minecraft:cobblestone";
    brick = "minecraft:stone_bricks";
    plank = "minecraft:oak_planks";
  }
  prefab BedCorner {
    set at = (0b, 0b, 0b) block = plank;
    set at = (1b, 0b, 0b) block = cobble;
  }
  floor ground {
    room taproom {
      anchor loot_a : game.LootSpawn {
        at = (2b, 1b, 2b);
        facing = south;
        tier = epic;
        mc_block = "minecraft:chest[facing=south]";
      }
    }
  }
}`,
    },
    {
      path: 'structures/inn.ashfox',
      source: `ashfox 1
structure inn {
  // Reordered palette keys should still produce identical structural hash.
  palette {
    plank = "minecraft:oak_planks";
    cobble = "minecraft:cobblestone";
    brick = "minecraft:stone_bricks";
  }
  prefab SleepCorner {
    set at = (0b, 0b, 0b) block = plank;
    set at = (1b, 0b, 0b) block = cobble;
  }
  floor ground {
    room common_room {
      anchor loot_b : game.LootSpawn {
        at = (2b, 1b, 2b);
        facing = south;
        tier = epic;
        mc_block = "minecraft:chest[facing=south]";
      }
    }
  }
}`,
    },
    {
      path: 'sounds/slash_a.ashfox',
      source: `ashfox 1
sound slash_a {
  profile = impact;
  duration = 0.45s;
  voice blade_whoosh : aero_whoosh {
    cutoff = 1800hz -> 8800hz ease_out -> 950hz;
    gain { env = ad; attack = 6ms; peak = 0.96; curve = exp; }
  }
}`,
    },
    {
      path: 'sounds/slash_b.ashfox',
      source: `ashfox 1
sound slash_b {
  profile = impact;
  duration = 0.45s;
  voice axe_whoosh : aero_whoosh {
    cutoff = 1800hz -> 8800hz ease_out -> 950hz;
    gain { env = ad; attack = 6ms; peak = 0.96; curve = exp; }
  }
}`,
    },
  ]);

  assert.equal(res.ok, false);
  assert.equal(res.duplicateGroups.length, 4);
  const kinds = res.duplicateGroups.map((g) => g.kind).sort();
  assert.deepEqual(kinds, ['anchor', 'palette', 'prefab', 'voice']);
  const dupDiags = res.diagnostics.filter((d) => d.code === 'modular.duplicate-boilerplate');
  assert.equal(dupDiags.length, 8);
  assert.ok(dupDiags.every((d) => d.message.includes('extract into a shared module')));
}

// 4. Legitimate ashfox 1 modular workspace + unused import/schema hygiene diagnostics.
{
  const cleanAndHygiene = checkWorkspaceModularity([
    {
      path: 'modules/game_world.ashfox',
      source: `ashfox 1
module game_world {
  export schema LootSpawn : anchor {
    field tier : enum(common, rare, epic) = common;
    field respawn : second = 120s;
    mc_block = "minecraft:chest[facing=\${facing}]";
  }
  export schema UnusedRule : meta {
    field radius : unit = 14u;
  }
}`,
    },
    {
      path: 'models/fox.ashfox',
      source: `ashfox 1
model fox {
  import "../modules/game_world.ashfox" as game;
  import "../modules/props.ashfox" as chest_prop;
  import "../modules/dead.ashfox" as unused_mod;

  settings { density = 16; forward = north; profile = creature; }
  anchor chest_a : game.LootSpawn {
    at = (1u, 0u, 1u);
    tier = epic;
    prefab = chest_prop;
  }
}`,
    },
    {
      path: 'sprites/gem.ashfox',
      source: `ashfox 1
sprite gem {
  palette { core = #4cc9f0; }
}`,
    },
    {
      path: 'sprites/orb.ashfox',
      source: `ashfox 1
sprite orb {
  palette { core = #4cc9f0; }
}`,
    },
  ]);

  assert.equal(cleanAndHygiene.ok, true, JSON.stringify(cleanAndHygiene.diagnostics));
  assert.deepEqual(
    cleanAndHygiene.diagnostics.map((d) => ({
      code: d.code,
      severity: d.severity,
      token: d.token,
    })),
    [
      {
        code: 'modular.unused-import',
        severity: 'warning',
        token: 'models/fox.ashfox#import:unused_mod',
      },
      {
        code: 'modular.unused-schema',
        severity: 'warning',
        token: 'modules/game_world.ashfox#schema:game_world.UnusedRule',
      },
    ],
  );
}

// 5. File order independence (determinism) & LHS property-key shadowing does not mark import used.
{
  const fileA = {
    path: 'entries/a.ashfox',
    source: `ashfox 1
structure a {
  import "../modules/game.ashfox" as table;
  import "../modules/game.ashfox" as game;
  floor ground {
    room hall {
      anchor x : game.LootSpot {
        at = (0b, 0b, 0b);
        table = "shadowed_lhs_key";
      }
    }
  }
}`,
  };
  const fileB = {
    path: 'modules/game.ashfox',
    source: `ashfox 1
module game {
  export schema LootSpot : anchor {
    field table : string;
  }
}`,
  };
  const forward = checkWorkspaceModularity([fileA, fileB]);
  const reverse = checkWorkspaceModularity([fileB, fileA]);
  assert.deepEqual(forward, reverse);
  assert.ok(
    forward.diagnostics.some(
      (d) => d.code === 'modular.unused-import' && d.token === 'entries/a.ashfox#import:table',
    ),
  );
}
