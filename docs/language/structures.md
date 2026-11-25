# Structure syntax

Structures describe Minecraft buildings and furnished interiors in `.ashfox` source.
One `structure` compiles both a Minecraft Java Edition template (`.nbt`, placed via
`/place template`) and a game-ready GLB mesh (`1 block = 1.0m`) with hierarchical
`exterior`, `interior`, and `custom` scene groups for open-world engines such as Unity.

## Units and header

Use the shared `ashfox-model 1` header with either an entry `structure` or a reusable `module`:

| Unit | Role | Allowed declarations |
| --- | --- | --- |
| `structure id { … }` | Buildable building entry | `import`, `size`, `data_version`, `palette`, `prefab`, `build` |
| `module id { … }` | Shared prefab/furnishing library | `import`, `palette`, `export prefab`, `prefab` |

- `size = (width, height, depth);`: integer grid dimensions (`1..64`, total volume `<= 65536`). When omitted, bounds are inferred from placed blocks.
- `data_version = 3955;`: Minecraft Java DataVersion written to `.nbt` (defaults to `3955`, Minecraft 1.21).
- Coordinates `(x, y, z)` are `0`-indexed voxels where `+y` is up and `-z` is north (`forward = north`).

## Palette and custom models

Declare reusable Minecraft block states and optional custom `.ashfox` props inside `palette { … }`:

```text
palette {
  wall = "minecraft:stone_bricks";
  door = "minecraft:spruce_door[facing=north,half=lower,hinge=left,open=false]";
  lantern = asset custom_lantern as "minecraft:lantern[hanging=false]";
}
```

- Every state must use the `namespace:block_id[key=value,...]` syntax (`minecraft:` built-ins render textured 3D shapes—stairs, slabs, fences, walls, panes, doors, trapdoors, lanterns, beds, chests, barrels, furnaces, bookshelves, carpets, pots, ladders).
- `asset alias as "fallback"` places an imported `.ashfox` model (`asset Name { … }`) in GLB and `render` previews while writing the specified Minecraft block state (inheriting `facing`) into `.nbt`.

## Prefabs and build operations

Inside `prefab Name { … }` (or `export prefab Name { … }` in a `module`) and `build { … }`, compose geometry declaratively:

| Operation | Behavior |
| --- | --- |
| `set at = (x, y, z) block = key [facing = north\|south\|east\|west];` | Place one block or custom prop |
| `box from = … to = … block = key;` | Fill an axis-aligned solid volume |
| `hollow from = … to = … block = key;` | Six outer shell faces of a box, interior untouched |
| `walls from = … to = … block = key;` | Four vertical perimeter walls (open top/bottom) |
| `frame from = … to = … block = key;` | Twelve outer structural edges (posts & beams) |
| `carve from = … to = …;` | Clear voxels to `minecraft:air` |
| `roof style = gable\|hip\|pyramid axis = x\|z from = … to = … stair = k ridge = r [gable = g];` | Oriented stair slopes, ridge slabs, optional gable fill |
| `layer y = n origin = (x, z) { "…" } map { C = k; };` | Compact ASCII floorplan per Y slice (`'.'` skips cell) |
| `repeat axis = x\|y\|z count = n step = s { … }` | Stamp child ops `n` times along an axis |
| `mirror axis = x\|z center = n { … }` | Mirror blocks and block states across `axis = n` |
| `place Name [\| Alias.Name] at = (x, y, z) rotate …;` (`0\|90\|180\|270`) | Instantiate a prefab with automatic state rotation |

## Complete standalone example

```ashfox
ashfox-model 1
structure shrine_hut {
  size = (7, 9, 7);
  data_version = 3955;

  palette {
    cobble = "minecraft:cobblestone";
    plank = "minecraft:oak_planks";
    timber = "minecraft:spruce_log[axis=y]";
    stair = "minecraft:spruce_stairs";
    ridge = "minecraft:spruce_slab[type=bottom]";
    door_lo = "minecraft:oak_door[facing=north,half=lower,hinge=left,open=false]";
    door_hi = "minecraft:oak_door[facing=north,half=upper,hinge=left,open=false]";
    glass = "minecraft:glass_pane";
    lantern = "minecraft:lantern[hanging=false]";
    bed_h = "minecraft:red_bed[facing=north,part=head]";
    bed_f = "minecraft:red_bed[facing=north,part=foot]";
    chest = "minecraft:chest[facing=north]";
    carpet = "minecraft:red_carpet";
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

  build {
    box from = (1, 0, 1) to = (5, 0, 5) block = cobble;
    box from = (2, 0, 2) to = (4, 0, 4) block = plank;
    walls from = (1, 1, 1) to = (5, 4, 5) block = plank;
    frame from = (1, 1, 1) to = (5, 4, 5) block = timber;
    carve from = (2, 1, 2) to = (4, 4, 4);
    set at = (3, 1, 5) block = door_lo;
    set at = (3, 2, 5) block = door_hi;
    mirror axis = x center = 3 {
      set at = (1, 2, 3) block = glass;
    }
    roof style = gable axis = z from = (0, 4, 0) to = (6, 7, 6) stair = stair ridge = ridge gable = plank;
    place BedNook at = (2, 1, 2) rotate = 0;
    set at = (4, 1, 2) block = carpet;
    set at = (2, 2, 2) block = lantern;
  }
}
```

## Check, preview and build

```sh
npx --no-install ashfox check examples/structure/medieval_cottage.ashfox --json
npx --no-install ashfox render --view cutaway examples/structure/medieval_cottage.ashfox --output cottage_inside.png
npx --no-install ashfox build examples/structure/medieval_cottage.ashfox --json
```

Standalone `ashfox build` honors declared `outputs { ... }` and defaults to producing both `.nbt` (`java_structure`) and `1 block = 1.0m` `.glb` (`glb`) from the same `.ashfox` source. Every structure must pass five hard gates (`visible_geometry`, `ground_contact`, `no_disconnected_floating_parts`, `enclosed_interior`, `valid_minecraft_ids`) and score `>= 75/100` (`>= 85` `excellent`). Declare `preview cutaway { cutaway = 4; }` inside the structure entry to slice open interiors during `render --view cutaway`. Unused palette keys, unused imports, or unused private prefabs are rejected at compile time.
