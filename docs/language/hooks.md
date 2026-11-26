# Hooks and Schemas

Ashfox assets share typed gameplay semantics across `model`, `structure`, `sprite`, and `sound` units using domain-neutral hooks: `schema`, `anchor`, `volume`, `cue`, `meta`, `zone`, and `mc_block`.

## Design Rules

- **Modular schema definitions**: reusable `schema` blocks belong in `module` files (`assets/module/*.ashfox`) and are declared with `export schema`. Entry files (`model`, `structure`, `sprite`, `sound`) import module schemas and attach instances instead of defining inline schemas.
- **No implicit coupling**: schema types live in the language grammar (`ashfox 1`), separate from game-specific titles or asset names.
- **Built-in `std.*` schemas**: `std.entry`, `std.road`, `std.wall_join`, `std.courtyard`, `std.sit`, `std.door_hinge`, `std.hitbox`, and `std.sfx` are available without imports.

## Declaring Schemas in Modules

```text
ashfox 1
module gameplay_rules {
  export schema LootSpawn : anchor {
    field tier : enum(common, rare, epic) = common;
    field chance : float(0..1) = 0.65;
    field table : string;
    field prefab? : asset;
    mc_block = "minecraft:chest[facing=${facing}]";
  }

  export schema StormShelter : volume {
    field shield_ratio : float(0..1) = 1.0;
  }

  export schema MeleeHitbox : cue {
    field arc_deg : deg(10..360) = 110deg;
    field damage : number = 20;
  }

  export schema AiHearing : meta {
    field radius : float(0..120);
  }
}
```

### Supported Field Types

- Primitives: `string`, `bool`, `number`, `int`, `int(min..max)`, `float`, `float(min..max)`, `asset`
- Dimensioned numbers: `unit` / `u`, `block` / `b`, `pixel` / `px`, `deg` (`deg(min..max)`), `second` / `s` / `ms`
- Vectors: `vec2`, `vec3`
- Enumerations: `enum(value_a, value_b, ...)` (bare identifiers at use sites, not quoted strings)
- Optional fields: append `?` after the field name (e.g. `field prefab? : asset;`)

## Hook Declarations on Assets

- **`anchor <id> : <schema> { ... }`**: point marker in 3D (`u`, `b`) or 2D sprite coordinates (`px`), optionally parented with `bone = <id>;`, `room = <id>;`, or `floor = <id>;`, plus `at = (...);` and `facing = north|south|east|west|up|down;`.
- **`volume <id> : <schema> { ... }`**: spatial bounds via `from`/`to` or `from`/`size`, with optional `bone`/`room`/`floor` parenting and `enclosure = enclosed|semi_open|open;`.
- **`cue <id> : <schema> { ... }`**: timeline marker or span via `clip = <name>;` and `at = <time>` or `at = <from>..<to>`.
- **`meta <id> : <schema> { ... }`**: arbitrary typed metadata bound via `target = <asset|sound>;` or global parameters.
- **`zone <id> [: std.courtyard] { ... }`**: structure circulation/enclosure region with `enclosure = enclosed|semi_open|open;`.
- **`mc_block <anchor_id> = "<blockstate>";`**: overrides a schema's `mc_block` template for a specific structure anchor during Minecraft `.nbt` lowering.

## Standalone Structure Hook Example

```ashfox
ashfox 1
structure shrine_outpost {
  density = 2;
  seed = 77;
  size = (9b, 13b, 9b);
  data_version = 3955;

  outputs = [java_structure, glb];

  palette {
    cobble = mix("minecraft:cobblestone" * 70%, "minecraft:mossy_cobblestone" * 30%);
    moss_cobble = "minecraft:mossy_cobblestone";
    plaster = mix("minecraft:white_terracotta" * 85%, "minecraft:calcite" * 15%);
    stone_brick = "minecraft:stone_bricks";
    chimney_brick = "minecraft:bricks";
    plank = "minecraft:oak_planks";
    spruce = "minecraft:spruce_planks";
    timber = "minecraft:spruce_log[axis=y]";
    beam = "minecraft:spruce_log[axis=x]";
    stair = "minecraft:spruce_stairs";
    trim_stair = "minecraft:dark_oak_stairs";
    ridge = "minecraft:spruce_slab[type=bottom]";
    porch_stair = "minecraft:cobblestone_stairs[facing=north,half=bottom]";
    door = "minecraft:oak_door[facing=north,half=lower,hinge=left,open=false]";
    glass = "minecraft:glass_pane";
    sill = "minecraft:spruce_slab[type=top]";
    shutter = "minecraft:oak_trapdoor[facing=south,half=bottom,open=true]";
    lantern = "minecraft:lantern[hanging=true]";
    porch_lamp = "minecraft:lantern[hanging=false]";
    bed_h = "minecraft:red_bed[facing=north,part=head]";
    bed_f = "minecraft:red_bed[facing=north,part=foot]";
    chest = "minecraft:chest[facing=north]";
    bookshelf = "minecraft:bookshelf";
    table = "minecraft:crafting_table";
  }

  prefab BedNook {
    layer {
      y = 0b;
      origin = (0b, 0b);
      rows = ["hc", "f."];
      map { h = bed_h; f = bed_f; c = chest; }
    }
  }

  prefab StudyNook {
    layer {
      y = 0b;
      origin = (0b, 0b);
      rows = ["bt"];
      map { b = bookshelf; t = table; }
    }
  }

  floor ground {
    y = 0b;
    height = 4b;
    room cell { from = (1b, 1b); size = (7b, 6b); kind = outpost; plinth = cobble; floor = plank; wall = plaster; frame = timber; ceiling = spruce; }
    facade cell.south {
      door {
        at = center; width = 1b; height = 2b; block = door; hinge = left; frame = timber; lintel = beam;
        porch { depth = 1; floor = stone_brick; pillars = timber; lamps = porch_lamp; steps = porch_stair; }
      }
    }
    facade windows {
      on = [cell.east, cell.west, cell.north];
      window { at = center; width = 1b; height = 2b; y_offset = 1b; glass = glass; sill = sill; shutter = shutter; lintel = beam; }
    }
  }

  roof {
    on = cell; style = gable; axis = z; overhang = 1b; pitch = standard;
    stair = stair; trim = trim_stair; ridge = ridge; gable = plaster; under_eave = true;
    chimney { room = cell; corner = nw; offset = (0b, 0b); width = 1b; rise = 2b; block = chimney_brick; cap = true; }
  }

  furnish cell {
    place_anchor { prefab = BedNook; on = nw; offset = (0b, 0b); rotate = 0; }
    place_anchor { prefab = StudyNook; on = se; offset = (0b, 0b); rotate = 0; }
    hang { block = lantern; at = ceiling_center; drop = 1b; }
  }

  weathering {
    ground_moss { height = 2b; target = cobble; into = moss_cobble; rate = 30%; }
    corner_quoin { target = plaster; corners = stone_brick; }
  }

  anchor main_door : std.entry { room = cell; wall = south; normal = south; pool = "village:streets"; target = "road_join"; }
  zone courtyard_zone : std.courtyard {
    from = (1b, 0b, 7b);
    to = (7b, 3b, 8b);
    enclosure = semi_open;
    shape = rect;
    pool = "yard";
  }
}
```

## Outputs and Engine Bindings

- **Sidecar JSON**: builds emit `<target>.hooks.json` alongside asset outputs whenever an asset declares hooks.
- **glTF**: 3D models and structures append `anchor_<id>` Empty Nodes (parented to the referenced bone node when `bone` is specified) with zero added draw calls, plus normalized hook payloads in `extras.ashfox.hooks`.
- **Typed codegen**: pass `--bindings ts|cs|gd` (for example `ashfox build --bindings ts,cs,gd`) to emit TypeScript (`.d.ts`), Unity C# (`.cs`), and Godot GDScript (`.gd`) interfaces under `<build>/bindings/`.
