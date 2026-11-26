# Structure syntax

Structures describe parametric buildings, furnished interiors, and multi-building compounds in `.ashfox` source.
One `structure` or `compound` compiles a Minecraft Java Edition template (`.nbt`, placed via `/place template`),
a baked `1 block = 1.0m` GLB mesh with `COLOR_0` voxel AO + warm lightmap and instanced custom `.ashfox` props,
and a `.structure.json` (`PlayableStructureMeta`) runtime manifest for game engines and `game_assets` packs.

## Units and header

Use the shared `ashfox 1` header with an entry `structure`, a `compound`, or a reusable `module`:

| Unit                 | Role                               | Allowed declarations                                                                                              |
| -------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `structure id { … }` | Buildable building entry           | `import`, `density`, `seed`, `size`, `data_version`, `params`, `outputs`, `preview`, `palette`, `prefab`, `floor`, `staircase`, `roof`, `furnish`, `weathering`, `socket`, voxel ops |
| `compound id { … }`  | Multi-building layout entry        | Same as `structure`, importing child `structure` entries for `compound_place`                                     |
| `module id { … }`    | Shared prefab & furnishing library | `import`, `palette`, `export prefab`, `prefab`                                                                    |

- `density = 1 | 2;`: procedural multi-tile texture resolution (`16px` at `1`, `32px` at `2`, defaults to `2`).
- `seed = 101;`: deterministic PRNG seed for `mix(...)` palettes, weathering, and surface grain.
- `size = (9b, 13b, 9b);`: integer voxel dimensions (`1b..96b`, total volume `<= 131072`).
- `data_version = 3955;`: Minecraft Java DataVersion written to `.nbt` (defaults to `3955`, Minecraft 1.21).
- `params { w = 13; half = floor(w / 2); }`: typed scalar parameters and math helpers (`floor`, `ceil`, `round`, `min`, `max`, `abs`, `clamp`) usable in expressions and `(x, z)` / `(x, y, z)` coordinates.
- Coordinates `(x, y, z)` are `0`-indexed voxels where `+y` is up and `-z` is north (`forward = north`).

## Palette, material mixes, and custom models

Declare Minecraft block states, weighted `mix(...)` palettes, and custom `.ashfox` props inside `palette { … }`:

```text
palette {
  wall = mix("minecraft:stone_bricks" * 70%, "minecraft:mossy_stone_bricks" * 20%, "minecraft:cracked_stone_bricks" * 10%);
  door = "minecraft:spruce_door[facing=north,half=lower,hinge=left,open=false]";
  lantern = asset(custom_lantern, "minecraft:lantern[hanging=false]");
}
```

- Every state uses `namespace:block_id[key=value,...]` syntax. The solver automatically resolves corner stairs (`inner_left|inner_right|outer_left|outer_right`) and connected fence/wall/pane sides (`north|east|south|west`), and emits `minecraft:jigsaw` block entities for `socket` connectors in `.nbt`.
- `mix("block" * weight, ...)` selects deterministic seeded surface variation per voxel (supports decimal ratios or `%`).
- `asset(alias, "fallback")` places an imported `.ashfox` model (`model Name { … }`) as an instanced mesh in GLB and `render` previews while writing the specified Minecraft fallback state into `.nbt`.

## Semantic layout and architectural ops

Inside `prefab Name { … }` (or `export prefab Name { … }` in a `module`) and at the top level of `structure` / `compound`, compose buildings using `{ key = value; }` blocks:

| Operation | Behavior |
| --- | --- |
| `floor name { y = 0b; height = 4b; [jetty = 1b;] … }` | Scope rooms and facades to one story (`height >= 3b`) with optional cantilevered `jetty` overhang (`0b..2b`) |
| `room id { from = (x, z); size = (w, d); kind = …; floor = k; wall = k; … }` | Declare semantic room (`living\|workshop\|bedroom\|tavern\|tower\|hallway\|courtyard`) |
| `facade <targets> { door { … } window { … } arch { … } bay_window { … } arcade { … } }` | Place doors (with `porch { … }`), shuttered windows, `bay_window` alcoves, `arcade` colonnades, and arches |
| `staircase { in_room = r; style = straight\|l_turn\|u_turn\|spiral; at = (x, z); … }` | Generate stairs with protected `>= 2b` headroom and automatic upper-slab cuts |
| `roof { on = r; style = gable\|hip\|pyramid\|spire; axis = x\|z; … }` | Build pitched stair roofs or `spire` turrets with dormers and chimneys |
| `furnish room { place_anchor { … } hang { … } }` | Anchor furniture prefabs to corners/walls/center and hang ceiling lights |
| `weathering { ground_moss { … } corner_quoin { … } chimney_soot { … } }` | Apply deterministic ground moss, corner quoins, and chimney soot |
| `socket id { kind = …; room = r; wall = …; normal = …; }` | Record world-connection sockets in `.structure.json` and `.nbt` jigsaw entities |
| `compound_place alias { at = (x, y, z); rotate = 0\|90\|180\|270; }` | Place an imported child `structure` inside a `compound` unit |
| `set`, `box`, `hollow`, `walls`, `frame`, `carve`, `layer`, `repeat`, `mirror`, `place` | Low-level voxel, ASCII floorplan (`layer { at = …; rows = […]; map { … } }`), repeat/mirror, and prefab placement ops |

## Complete canonical example

```ashfox
ashfox 1
structure shrine_hut {
  density = 2;
  seed = 77;
  size = (9b, 13b, 9b);
  data_version = 3955;

  outputs = [java_structure, glb];

  preview exterior { sheet = exterior; }
  preview cutaway { sheet = cutaway; }
  preview interior { sheet = interior; }

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
      map {
        h = bed_h;
        f = bed_f;
        c = chest;
      }
    }
  }

  prefab StudyNook {
    layer {
      y = 0b;
      origin = (0b, 0b);
      rows = ["bt"];
      map {
        b = bookshelf;
        t = table;
      }
    }
  }

  floor ground {
    y = 0b;
    height = 4b;
    room cell { from = (1b, 1b); size = (7b, 6b); kind = bedroom; plinth = cobble; floor = plank; wall = plaster; frame = timber; ceiling = spruce; }
    facade cell.south {
      door {
        at = center;
        width = 1b;
        height = 2b;
        block = door;
        hinge = left;
        frame = timber;
        lintel = beam;
        porch {
          depth = 1;
          floor = stone_brick;
          pillars = timber;
          lamps = porch_lamp;
          steps = porch_stair;
        }
      }
    }
    facade windows {
      on = [cell.east, cell.west, cell.north];
      window { at = center; width = 1b; height = 2b; y_offset = 1b; glass = glass; sill = sill; shutter = shutter; lintel = beam; }
    }
  }

  roof {
    on = cell;
    style = gable;
    axis = z;
    overhang = 1b;
    pitch = standard;
    stair = stair;
    trim = trim_stair;
    ridge = ridge;
    gable = plaster;
    under_eave = true;
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

  socket main_door { kind = entry; room = cell; wall = south; normal = south; pool = "village:streets"; target = "road_join"; }
}
```

## Check, preview sheets, and build

```sh
npx --no-install ashfox check examples/structure/.ashfoxworkspace --json
npx --no-install ashfox render --view cutaway examples/structure/assets/structures/medieval_cottage.ashfox --output cottage_cutaway.png
npx --no-install ashfox build examples/structure/.ashfoxworkspace --json
```

Standalone `ashfox build` honors declared `outputs = [...];` (or `outputs { ... }`) and defaults to producing `.nbt` (`java_structure`) plus `1 block = 1.0m` `.glb` and `.structure.json` (`PlayableStructureMeta` colliders, semantic zones, lights, sockets, and interactables) from the same `.ashfox` source. GLB builds apply hidden-face and trim strip culling, sub-voxel atlas batching, GPU instancing (`EXT_mesh_gpu_instancing`) for repeated custom props, and 3-tier semantic LOD (`_LOD0`, `_LOD1` simplified envelope `<= 25%` tris, `_LOD2` single-draw vertex-color horizon hull with `MSFT_lod` and `extras.ashfox.lod`). Structures target `<= 18` draw calls / `<= 18,000` tris / `<= 350 KB` (`<= 28` draw calls / `<= 45,000` tris / `<= 1.1 MB` for `compound`). Every structure must pass six hard gates (`visible_geometry`, `ground_contact`, `structural_continuity`, `playable_circulation`, `weatherproof_enclosure`, `valid_minecraft_ids`) and score `>= 75/100` (`>= 85` `excellent`) across four pillars (`architecture`, `facade`, `interior`, `craft`). Declare `preview exterior { sheet = exterior; }`, `preview cutaway { sheet = cutaway; }`, or `preview interior { sheet = interior; }` to inspect architectural elevations, per-floor horizontal cuts, and room-centered eye-level views. Unused palette keys, unused imports, or unused private prefabs are rejected at compile time.
