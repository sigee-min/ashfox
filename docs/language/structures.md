# Structure syntax

Structures describe parametric buildings, furnished interiors, and multi-building compounds in `.ashfox` source.
One `structure` or `compound` compiles a Minecraft Java Edition template (`.nbt`, placed via `/place template`),
a baked `1 block = 1.0m` GLB mesh with `COLOR_0` voxel AO + warm lightmap and instanced custom `.ashfox` props,
and a `.structure.json` (`PlayableStructureMeta`) runtime manifest for game engines and `game_assets` packs.

## Units and header

Use the shared `ashfox 1` header with an entry `structure`, a `compound`, or a reusable `module`:

| Unit                 | Role                               | Allowed declarations                                                                                              |
| -------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `structure id { … }` | Buildable building entry           | `import`, `density`, `seed`, `size`, `data_version`, `params`, `outputs`, `preview`, `palette`, `prefab`, `floor`, `staircase`, `roof`, `furnish`, `weathering`, `anchor`, `volume`, `zone`, `mc_block`, voxel ops |
| `compound id { … }`  | Multi-building layout entry        | Same as `structure`, importing child `structure` entries for `compound_place`                                     |
| `module id { … }`    | Shared prefab, schema & furnishing library | `import`, `palette`, `export schema`, `export prefab`, `prefab`                                              |

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

- Every state uses `namespace:block_id[key=value,...]` syntax. The solver automatically resolves corner stairs (`inner_left|inner_right|outer_left|outer_right`) and connected fence/wall/pane sides (`north|east|south|west`), and emits `minecraft:jigsaw` block entities for `std.entry`, `std.road`, and `std.wall_join` `anchor` connectors in `.nbt`.
- `mix("block" * weight, ...)` selects deterministic seeded surface variation per voxel (supports decimal ratios or `%`).
- `asset(alias, "fallback")` places an imported `.ashfox` model (`model Name { … }`) as an instanced mesh in GLB and `render` previews while writing the specified Minecraft fallback state into `.nbt`.

## Semantic layout and architectural ops

Inside `prefab Name { … }` (or `export prefab Name { … }` in a `module`) and at the top level of `structure` / `compound`, compose buildings using `{ key = value; }` blocks:

| Operation | Behavior |
| --- | --- |
| `floor name { y = 0b; height = 4b; [jetty = 1b;] … }` | Scope rooms and facades to one story (`height >= 3b`) with optional cantilevered `jetty` overhang (`0b..2b`) |
| `room id { from = (x, z); size = (w, d); kind = …; floor = k; wall = k; … }` | Declare semantic room (open identifier such as `living`, `tavern`, `bedroom`, or custom game role) |
| `facade <targets> { door { … } window { … } arch { … } bay_window { … } arcade { … } }` | Place doors (with `porch { … }`), shuttered windows, `bay_window` alcoves, `arcade` colonnades, and arches |
| `staircase { in_room = r; style = straight\|l_turn\|u_turn\|spiral; at = (x, z); … }` | Generate stairs with protected `>= 2b` headroom and automatic upper-slab cuts |
| `roof { on = r; style = gable\|hip\|pyramid\|spire; axis = x\|z; … }` | Build pitched stair roofs or `spire` turrets with dormers and chimneys |
| `interior [room] { dna { … } architecture { … } … }` | Author cross-genre 5-layer interior shells, sculpted volumes, props, drapery, tabletop stories, 2-bounce radiosity GI, and volumetric `sun_shaft` beams |
| `furnish room { place_anchor { … } hang { … } }` | Anchor furniture prefabs to corners/walls/center and hang ceiling lights |
| `weathering { ground_moss { … } corner_quoin { … } chimney_soot { … } }` | Apply deterministic ground moss, corner quoins, and chimney soot |
| `anchor id : std.entry\|std.road\|<schema> { room = r; wall = …; … }` | Record world-connection connectors and typed gameplay anchors in `.structure.json`, `.hooks.json`, glTF `anchor_*` Empty Nodes, and `.nbt` jigsaw/block entities |
| `zone id [: std.courtyard] { … }` | Record semantic circulation or courtyard enclosure regions |
| `compound_place alias { at = (x, y, z); rotate = 0\|90\|180\|270; }` | Place an imported child `structure` inside a `compound` unit |
| `for i in start..end { … }` | Deterministic compile-time loop unrolling (`<= 128` iterations, depth `<= 3`) with `${i}` interpolation and `(expr)b` integer math |
| `set`, `box`, `hollow`, `walls`, `frame`, `carve`, `layer`, `repeat`, `mirror`, `place` | Low-level voxel, ASCII floorplan (`layer { at = …; rows = […]; map { … } }`), repeat/mirror, and prefab placement ops |

## Interior architecture, props, and radiosity

Nest `interior { … }` directly inside a `room` block (or declare `interior room_id { … }` at `structure` top level) to compose genre-coherent interiors in `1/16` sub-voxel space without stair/slab furniture hacks:

```text
interior {
  dna { arch = japanese; mood = zen_daylight; }
  architecture { floor_pattern = tatami; baseboard = trim; wainscot = shoji_lattice; molding = timber_cornice; ceiling = slatted; }
  platform dais {
    on = north; size = (5, 2); height = 0.25; step_facing = south;
    alcove tokonoma { kind = tokonoma; wall = north; width = 3; height = 3; }
  }
  partition screen { style = sliding_shoji; axis = x; at = 9; span_from = 2; span_to = 14; doorway_at = 7; doorway_width = 2; open_ratio = 0.45; }
  centerpiece {
    on = center;
    low_table chabudai { size = (2, 2); }
    cushion { on = west; }
    story tea_ceremony { on = chabudai; }
  }
  drapery noren { kind = noren; on = doors; split_panels = 3; color = "#243b55"; }
  lighting { bounces = 2; ambient_floor = 0.16; stained_glass_boost = 1.25; }
  sun_shaft { enabled = true; sun_dir = (0.3, -0.75, 0.58); intensity = 0.5; shaft_length = 6.0; }
}
```

- `dna { arch = …; [furn = …;] [mood = …;] [organic = 0..1;] }`: select closed architectural style DNA (`rustic`, `japanese`, `modern`, `scifi`, `gothic`, `desert`, `industrial`, `nordic`) and radiosity mood (`warm_hearth`, `zen_daylight`, `minimal_bright`, `cyber_neon`, `arcane_dusk`, `sunbaked_ochre`).
- `architecture`: override the 5-layer shell (`floor_pattern`, `baseboard`, `wainscot`, `molding`, `ceiling`), including `open_truss`, `slatted`, `coffered`, `vault`, `led_strip`, and `neon_channel`.
- Volumes & anchors: `platform` / `sunken`, `mezzanine`, `open_truss`, `alcove`, `partition`, `wall_line`, `centerpiece`, and `corner` support nested furniture (`dining_set`, `l_counter`, `low_table`, `cushion`, `sofa`, `shelving`, `terminal`, `console_terminal`, `holo_screen`, `barrel_rack`, `cabinet`), hanging `drapery` (`curtains`, `noren`, `banner`, `chains`, `cables`, `pipes`), and tabletop `story` vignettes (`tavern_meal`, `tea_ceremony`, `scholar_study`, `modern_workspace`, `scifi_diagnostics`, `hearth_prep`, `alchemy_brew`).
- Radiosity, sun shafts, and stained glass: `facade` `window`/`bay_window` entries accept `stained_glass_color = "#hex"` to render double-sided translucent glass panes and tinted 2-bounce indirect GI + volumetric `sun_shaft` additive quads. The BFS solver enforces `>= 2b` Minecraft `.nbt` (`data_version = 3955`) headroom, zero floating blocks, and unobstructed openings.

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

  anchor main_door : std.entry { room = cell; wall = south; normal = south; pool = "village:streets"; target = "road_join"; }
}
```

## Check, preview sheets, and build

```sh
npx --no-install ashfox check showcase/.ashfoxworkspace --json
npx --no-install ashfox render --view cutaway showcase/assets/structures/tavern.ashfox --output tavern_cutaway.png
npx --no-install ashfox build showcase/.ashfoxworkspace --json
```

Built-in `"std/structure/..."` architecture, interior, and furnishing modules are available via `ashfox library std list structure`. Standalone `ashfox build` honors declared `outputs = [...];` (or `outputs { ... }`) and defaults to producing `.nbt` (`java_structure`) plus `1 block = 1.0m` `.glb` and `.structure.json` (`PlayableStructureMeta` colliders, semantic zones, lights, sockets, and interactables) from the same `.ashfox` source. GLB builds apply hidden-face and trim strip culling, sub-voxel atlas batching, GPU instancing (`EXT_mesh_gpu_instancing`) for repeated custom props, and 3-tier semantic LOD (`_LOD0`, `_LOD1` simplified envelope `<= 25%` tris, `_LOD2` single-draw vertex-color horizon hull with `MSFT_lod` and `extras.ashfox.lod`). Structures target `<= 18` draw calls / `<= 18,000` tris / `<= 350 KB` (`<= 28` draw calls / `<= 45,000` tris / `<= 1.1 MB` for `compound`). Every structure must pass six hard gates (`visible_geometry`, `ground_contact`, `structural_continuity`, `playable_circulation`, `weatherproof_enclosure`, `valid_minecraft_ids`) and score `>= 75/100` (`>= 85` `excellent`) across four pillars (`architecture`, `facade`, `interior`, `craft`). Declare `preview exterior { sheet = exterior; }`, `preview cutaway { sheet = cutaway; }`, or `preview interior { sheet = interior; }` to inspect architectural elevations, per-floor horizontal cuts, and room-centered eye-level views. Unused palette keys, unused imports, or unused private prefabs are rejected at compile time.
