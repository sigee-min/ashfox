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
    id: 'br_rules.loot_spot',
    namespace: 'br_rules',
    name: 'loot_spot',
    exported: true,
    inline: false,
    targets: ['anchor'],
    span: span('modules/br_rules.ashfox', 3),
    fields: [
      {
        name: 'tier',
        type: { kind: 'union', values: ['common', 'rare', 'epic'] },
        optional: false,
        defaultValue: { kind: 'string', value: 'common', span: span('modules/br_rules.ashfox', 4) },
        span: span('modules/br_rules.ashfox', 4),
      },
      {
        name: 'chance',
        type: { kind: 'float', min: 0, max: 1 },
        optional: false,
        defaultValue: {
          kind: 'number',
          value: 0.65,
          unit: 'plain',
          span: span('modules/br_rules.ashfox', 5),
        },
        span: span('modules/br_rules.ashfox', 5),
      },
      {
        name: 'table',
        type: { kind: 'string' },
        optional: false,
        span: span('modules/br_rules.ashfox', 6),
      },
      {
        name: 'prefab',
        type: { kind: 'asset' },
        optional: true,
        span: span('modules/br_rules.ashfox', 7),
      },
    ],
  },
  {
    id: 'br_rules.melee_hit',
    namespace: 'br_rules',
    name: 'melee_hit',
    exported: true,
    inline: false,
    targets: ['cue'],
    span: span('modules/br_rules.ashfox', 11),
    fields: [
      {
        name: 'priority',
        type: { kind: 'int', min: 1, max: 10 },
        optional: false,
        defaultValue: {
          kind: 'number',
          value: 5,
          unit: 'plain',
          span: span('modules/br_rules.ashfox', 12),
        },
        span: span('modules/br_rules.ashfox', 12),
      },
      {
        name: 'offset',
        type: { kind: 'vec3' },
        optional: true,
        span: span('modules/br_rules.ashfox', 13),
      },
      {
        name: 'event',
        type: { kind: 'bool' },
        optional: false,
        defaultValue: { kind: 'bool', value: true, span: span('modules/br_rules.ashfox', 14) },
        span: span('modules/br_rules.ashfox', 14),
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
  assert.deepEqual(all.ts.schemas, ['br_rules.loot_spot', 'br_rules.melee_hit']);

  // TypeScript assertions: literal union, range/default JSDoc, optional, SchemaMap, getHooks.
  assert.match(all.ts.content, /export interface BrRulesLootSpot/);
  assert.match(all.ts.content, /readonly tier: 'common' \| 'rare' \| 'epic';/);
  assert.match(all.ts.content, /@range float\[0, 1\] @default 0\.65/);
  assert.match(all.ts.content, /readonly prefab\?: AshfoxAssetRef;/);
  assert.match(all.ts.content, /readonly 'br_rules\.loot_spot': BrRulesLootSpot;/);
  assert.match(all.ts.content, /export declare function getHooks</);

  // Unity C# assertions: enum, [Range], nullable optional, keyword escape, defaults.
  assert.match(all.cs.content, /namespace Ashfox\.Hooks/);
  assert.match(all.cs.content, /public enum BrRulesLootSpotTier/);
  assert.match(all.cs.content, /Common = 0,\s+Rare = 1,\s+Epic = 2/);
  assert.match(all.cs.content, /\[Range\(0\.0f, 1\.0f\)\]/);
  assert.match(all.cs.content, /public float chance = 0\.65f;/);
  assert.match(all.cs.content, /public string prefab = null;/);
  assert.match(all.cs.content, /\[Range\(1, 10\)\]/);
  assert.match(all.cs.content, /public Vector3\? offset = null;/);
  assert.match(all.cs.content, /public bool @event = true;/);

  // Godot GDScript assertions: enum, @export_range, Variant optional, keyword escape.
  assert.match(all.gd.content, /class_name AshfoxHooks/);
  assert.match(all.gd.content, /class BrRulesLootSpot:/);
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

// 2. Reject inline schema definitions in entry files across domains.
{
  const res = checkWorkspaceModularity([
    {
      path: 'structures/tavern.ashfox',
      source: `ashfox-model 1
structure tavern {
  schema inline_loot on anchor {
    tier: "common" | "epic";
  }
  size = (9, 7, 9);
}`,
    },
    {
      path: 'sprites/sword.ashfox',
      source: `ashfox-model 1
sprite sword {
  schema inline_sprite_meta on meta {
    rarity: "rare";
  }
}`,
    },
    {
      path: 'sounds/hit.ashfox',
      source: `ashfox-model 1
sound hit {
  schema inline_sound_cue on cue {
    tag: string;
  }
}`,
    },
  ]);
  assert.equal(res.ok, false);
  const inlineDiags = res.diagnostics.filter((d) => d.code === 'hooks.inline-schema-forbidden');
  assert.equal(inlineDiags.length, 3);
  assert.deepEqual(
    inlineDiags.map((d) => d.token),
    [
      'sounds/hit.ashfox#schema:inline_sound_cue',
      'sprites/sword.ashfox#schema:inline_sprite_meta',
      'structures/tavern.ashfox#schema:inline_loot',
    ],
  );
}

// 3. Cross-file duplicate boilerplate detection across palette, prefab, voice, and hook blocks.
{
  const res = checkWorkspaceModularity([
    {
      path: 'structures/cottage.ashfox',
      source: `ashfox-model 1
structure cottage {
  palette {
    cobble = "minecraft:cobblestone";
    brick = "minecraft:stone_bricks";
    plank = "minecraft:oak_planks";
  }
  prefab BedCorner {
    set at = (0, 0, 0) block = plank;
    set at = (1, 0, 0) block = cobble;
  }
  anchor loot_a as br.loot_spot at = (2, 1, 2) {
    tier = "epic";
    chance = 0.45;
    table = "br:weapons";
  }
}`,
    },
    {
      path: 'structures/inn.ashfox',
      source: `ashfox-model 1
structure inn {
  // Reordered palette keys should still produce identical structural hash.
  palette {
    plank = "minecraft:oak_planks";
    cobble = "minecraft:cobblestone";
    brick = "minecraft:stone_bricks";
  }
  prefab SleepCorner {
    set at = (0, 0, 0) block = plank;
    set at = (1, 0, 0) block = cobble;
  }
  anchor loot_b as br.loot_spot at = (2, 1, 2) {
    tier = "epic";
    chance = 0.45;
    table = "br:weapons";
  }
}`,
    },
    {
      path: 'sounds/slash_a.ashfox',
      source: `ashfox-model 1
sound slash_a {
  voice blade_whoosh {
    source { kind = "whoosh"; freq = 420Hz; }
    gain = ad(10ms, 180ms);
  }
}`,
    },
    {
      path: 'sounds/slash_b.ashfox',
      source: `ashfox-model 1
sound slash_b {
  voice axe_whoosh {
    source { kind = "whoosh"; freq = 420Hz; }
    gain = ad(10ms, 180ms);
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

// 4. Legitimate non-duplicate hook usages & trivial palettes are NOT flagged, while unused imports/schemas are flagged.
{
  const cleanAndHygiene = checkWorkspaceModularity([
    {
      path: 'modules/br_rules.ashfox',
      source: `ashfox-model 1
module br_rules {
  export schema loot_spot on anchor {
    tier: "common" | "epic" = "common";
  }
  export schema unused_rule on meta {
    radius: float(0..100) = 10;
  }
}`,
    },
    {
      path: 'models/fox.ashfox',
      source: `ashfox-model 1
asset fox {
  import "../modules/br_rules.ashfox" as br;
  import "../modules/props.ashfox" as chest_prop;
  import "../modules/dead.ashfox" as unused_mod;
  export asset fox {
    anchor chest_a as br.loot_spot at = (1, 0, 1) {
      tier = "epic";
      prefab = chest_prop;
    }
  }
}`,
    },
    {
      path: 'sprites/gem.ashfox',
      source: `ashfox-model 1
sprite gem {
  palette { core = #4cc9f0; }
}`,
    },
    {
      path: 'sprites/orb.ashfox',
      source: `ashfox-model 1
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
        token: 'modules/br_rules.ashfox#schema:br_rules.unused_rule',
      },
    ],
  );
}

// 5. File order independence (determinism) & LHS property-key shadowing does not mark import used.
{
  const fileA = {
    path: 'entries/a.ashfox',
    source: `ashfox-model 1
structure a {
  import "../modules/br.ashfox" as table;
  anchor x as br.spot at = (0, 0, 0) {
    table = "shadowed_lhs_key";
  }
}`,
  };
  const fileB = {
    path: 'modules/br.ashfox',
    source: `ashfox-model 1
module br {
  export schema spot on anchor {
    table: string;
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
