# Structure syntax

Structures describe parametric buildings, furnished interiors, and multi-building compounds in `.ashfox` source.
One `structure` or `compound` compiles a Minecraft Java Edition template (`.nbt`, placed via `/place template`),
a baked `1 block = 1.0m` GLB mesh with `COLOR_0` voxel AO + warm lightmap and instanced custom `.ashfox` props,
and a `.structure.json` (`PlayableStructureMeta`) runtime manifest for game engines and `game_assets` packs.

## Units and header

Use the shared `ashfox-model 1` header with an entry `structure`, a `compound`, or a reusable `module`:

| Unit                 | Role                               | Allowed declarations                                                                                              |
| -------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `structure id { … }` | Buildable building entry           | `import`, `density`, `seed`, `size`, `data_version`, `params`, `outputs`, `preview`, `palette`, `prefab`, `build` |
| `compound id { … }`  | Multi-building layout entry        | Same as `structure`, importing child `structure` entries for `compound_place`                                     |
| `module id { … }`    | Shared prefab & furnishing library | `import`, `palette`, `export prefab`, `prefab`                                                                    |

- `density = 1 | 2;`: procedural multi-tile texture resolution (`16px` at `1`, `32px` at `2`, defaults to `2`).
- `seed = 101;`: deterministic PRNG seed for `mix(...)` palettes, weathering, and surface grain.
- `size = (width, height, depth);`: integer voxel dimensions (`1..96`, total volume `<= 131072`).
- `data_version = 3955;`: Minecraft Java DataVersion written to `.nbt` (defaults to `3955`, Minecraft 1.21).
- `params { w = 13; half = floor(w / 2); }`: typed scalar parameters and math helpers (`floor`, `ceil`, `round`, `min`, `max`, `abs`, `clamp`) usable in expressions and `(x, z)` / `(x, y, z)` coordinates.
- Coordinates `(x, y, z)` are `0`-indexed voxels where `+y` is up and `-z` is north (`forward = north`).

## Palette, material mixes, and custom models

Declare Minecraft block states, weighted `mix(...)` palettes, and custom `.ashfox` props inside `palette { … }`:

```text
palette {
  wall = mix("minecraft:stone_bricks" * 0.7, "minecraft:mossy_stone_bricks" * 0.2, "minecraft:cracked_stone_bricks" * 0.1);
  door = "minecraft:spruce_door[facing=north,half=lower,hinge=left,open=false]";
  lantern = asset custom_lantern as "minecraft:lantern[hanging=false]";
}
```

- Every state uses `namespace:block_id[key=value,...]` syntax. The solver automatically resolves corner stairs (`inner_left|inner_right|outer_left|outer_right`) and connected fence/wall/pane sides (`north|east|south|west`), and emits `minecraft:jigsaw` block entities for `socket` connectors in `.nbt`.
- `mix("block" * weight, ...)` selects deterministic seeded surface variation per voxel.
- `asset alias as "fallback"` places an imported `.ashfox` model (`asset Name { … }`) as an instanced mesh in GLB and `render` previews while writing the specified Minecraft fallback state into `.nbt`.

## Semantic layout and architectural ops

Inside `prefab Name { … }` (or `export prefab Name { … }` in a `module`) and `build { … }`, compose buildings semantically and refine with voxel primitives:

| Operation                                                                                                                                                                                                         | Behavior                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `floor name y = n height = h [jetty = n \| jetty_n = n …] { … }`                                                                                                                                                  | Scope rooms and openings to one story (`height >= 3`; `y` = floor slab) with optional cantilevered timber `jetty` overhang (`0..2`) & corbels            |
| `room id from = (x, z) size = (w, d) kind = … [shape = rect\|octagon] [plinth = k] floor = k wall = k [frame = k] [ceiling = k];`                                                                                   | Declare semantic room (`living\|workshop\|bedroom\|tavern\|tower\|hallway\|courtyard`); adjacent rooms may share a 1-block wall                           |
| `facade on room.wall, … { door …; window …; arch …; bay_window …; arcade …; }`                                                                                                                                   | Place doors (with `porch`), recessed/shuttered windows, projecting `bay_window` alcoves, vaulted `arcade` colonnades, and connecting arches               |
| `staircase [in_room = r] style = straight\|l_turn\|u_turn\|spiral at = (x, z) [y_from = n y_to = n] facing = … stair = k [landing = k rail = k headroom = 3];`                                                    | Generate stairs with protected `>= 2` headroom and automatic upper-slab cuts                                                                              |
| `roof [on = r \| from = … to = …] style = gable\|hip\|pyramid\|spire axis = x\|z [overhang = n pitch = shallow\|standard\|steep trim = k under_eave = true battlement = true] stair = k ridge = r [gable = g] [{ … }];` | Build pitched stair roofs or crenellated `spire` turrets with intersecting valley support, overhang trim, dormers, and chimneys                           |
| `furnish room = r { place_anchor prefab = … on = …; hang block = k at = … drop = n; }`                                                                                                                            | Anchor furniture prefabs to corners/walls/center and hang ceiling lights                                                                                  |
| `weathering { ground_moss …; corner_quoin …; chimney_soot …; }`                                                                                                                                                   | Apply deterministic ground moss, corner quoins, and chimney soot (`rate` `0..1`; eave AO shading is baked automatically per vertex)                       |
| `socket id kind = entry\|road\|wall_join\|courtyard (room = r wall = … \| at = …) normal = … [pool = "…" target = "…"];`                                                                                          | Record world-connection sockets in `.structure.json` and `.nbt` jigsaw entities                                                                           |
| `compound_place alias at = (x, y, z) rotate = 0\|90\|180\|270;`                                                                                                                                                   | Place an imported child `structure` inside a `compound` unit                                                                                              |
| `set`, `box`, `hollow`, `walls`, `frame`, `carve`, `layer`, `repeat`, `mirror`, `place`                                                                                                                           | Low-level voxel, ASCII floorplan, repeat/mirror, and prefab placement ops                                                                                 |

## Complete canonical example

```ashfox
ashfox-model 1
structure shrine_hut {
  density = 2;
  seed = 77;
  size = (9, 13, 9);
  data_version = 3955;

  outputs {
    java_structure;
    glb;
  }

  preview exterior { sheet = exterior; }
  preview cutaway { sheet = cutaway; }
  preview interior { sheet = interior; }

  palette {
    cobble = mix("minecraft:cobblestone" * 0.7, "minecraft:mossy_cobblestone" * 0.3);
    moss_cobble = "minecraft:mossy_cobblestone";
    plaster = mix("minecraft:white_terracotta" * 0.85, "minecraft:calcite" * 0.15);
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
    layer y = 0 origin = (0, 0) {
      "HC"
      "F."
    } map {
      H = bed_h;
      F = bed_f;
      C = chest;
    };
  }

  prefab StudyNook {
    layer y = 0 origin = (0, 0) {
      "BT"
    } map {
      B = bookshelf;
      T = table;
    };
  }

  build {
    floor ground y = 0 height = 4 {
      room cell from = (1, 1) size = (7, 6) kind = bedroom plinth = cobble floor = plank wall = plaster frame = timber ceiling = spruce;
      facade on cell.south {
        door at = center width = 1 height = 2 block = door hinge = left frame = timber lintel = beam porch {
          depth = 1;
          floor = stone_brick;
          pillars = timber;
          lamps = porch_lamp;
          steps = porch_stair;
        }
      }
      facade on cell.east, cell.west, cell.north {
        window at = center width = 1 height = 2 y_offset = 1 glass = glass sill = sill shutter = shutter lintel = beam;
      }
    }

    roof on = cell style = gable axis = z overhang = 1 pitch = standard stair = stair trim = trim_stair ridge = ridge gable = plaster under_eave = true {
      chimney room = cell corner = nw offset = (0, 0) width = 1 rise = 2 block = chimney_brick cap = true;
    }

    furnish room = cell {
      place_anchor prefab = BedNook on = nw offset = (0, 0) rotate = 0;
      place_anchor prefab = StudyNook on = se offset = (0, 0) rotate = 0;
      hang block = lantern at = ceiling_center drop = 1;
    }

    weathering {
      ground_moss height = 2 target = cobble into = moss_cobble rate = 0.3;
      corner_quoin target = plaster corners = stone_brick;
    }

    socket main_door kind = entry room = cell wall = south normal = south pool = "village:streets" target = "road_join";
  }
}
```

## Check, preview sheets, and build

```sh
npx --no-install ashfox check examples/structure/.ashfoxworkspace --json
npx --no-install ashfox render --view cutaway examples/structure/assets/structures/medieval_cottage.ashfox --output cottage_cutaway.png
npx --no-install ashfox build examples/structure/.ashfoxworkspace --json
```

Standalone `ashfox build` honors declared `outputs { ... }` and defaults to producing `.nbt` (`java_structure`) plus `1 block = 1.0m` `.glb` and `.structure.json` (`PlayableStructureMeta` colliders, semantic zones, lights, sockets, and interactables) from the same `.ashfox` source. Every structure must pass six hard gates (`visible_geometry`, `ground_contact`, `structural_continuity`, `playable_circulation`, `weatherproof_enclosure`, `valid_minecraft_ids`) and score `>= 75/100` (`>= 85` `excellent`) across four pillars (`architecture`, `facade`, `interior`, `craft`). Declare `preview exterior { sheet = exterior; }`, `preview cutaway { sheet = cutaway; }`, or `preview interior { sheet = interior; }` to inspect architectural elevations, per-floor horizontal cuts, and room-centered eye-level views. Unused palette keys, unused imports, or unused private prefabs are rejected at compile time.
