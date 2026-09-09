# Sprite syntax reference

A native sprite source produces one transparent 16×16 PNG. The profile
`minecraft-item-v1` fixes the raster rules; the PNG can be used in any game.
See the [sprite walkthrough](../guides/sprites.md) for preview and export commands.

## Root and literal syntax

Write `ashfox-model 1` followed by `sprite name { … }`. Required root properties
are `profile`, `canvas` and `palette`; layers are named declarations in source order.
Do not write generated `id`, `op`, `format` or `layers` properties by hand.

| Form | Example |
| --- | --- |
| Assignment | `canvas = (16px, 16px);` |
| Nested record | `palette { edge = #392b59; }` |
| List | `rows = ["ee", "e."];` |
| Empty list | `patches = [];` |
| Reference | `mask = shared.apple_body;` |

Numbers are nonnegative integers. Only `at`, `canvas` and `axis` permit `px`
suffixes, including inside their vectors. Other numeric fields are unitless.
There are no arithmetic expressions, model `design` declarations or function calls.
Strings follow the shared model lexer; quoted or bare enum/reference names are
accepted where the field expects a name. Quote values containing hyphens,
such as `"clustered-v1"` and `"warm-v1"`. `tx`, decimals and negative positions
are not sprite literals.

The sprite ID, layer IDs and palette names follow `[a-z][a-z0-9_]{0,47}`.
The palette contains at most 32 RGB colors. Rows are rectangular, 1–16 rows high
and 1–16 characters wide. Color rows use ASCII letters and `.`, while mask and
erase rows use `1` and `.`. Every colored character must have a color mapping.

## Layer records

All listed fields are required, including empty `patches`. Layer IDs are unique.
Coordinates are `[x,y]` from the canvas's top-left, and the complete layer must fit.

| Layer | Fields | Semantics |
| --- | --- | --- |
| `paint name` | `at`, `rows`, `colors` | Paint palette-bound characters; `.` leaves the underlying pixel alone |
| `erase name` | `at`, `rows` | `1` clears a pixel; `.` leaves it alone |
| `stamp name` | `stamp`, `at`, `flip`, `colors` | Use a reusable stamp; `flip` is `none`, `x`, `y`, or `xy` |
| `part name` | `mask`, `material`, `at`, `shade`, `grain`, `patches` | Shade a reusable occupied shape, then apply deliberate patches |

Later layers can cover earlier layers. A row of dots is not an erase operation.
The current profile permits up to 64 layers per sprite; this is separate from
the workspace's unrestricted export count.

## Reusable declarations

Put these inside a sprite or an imported sprite `module`. Reusable declarations
must be exported. Import with `import "./shared.ashfox" as shared;` and refer to
`shared.name`. Paths are explicit relative paths; package-name imports are not
supported by the sprite reader. Configured workspaces declare imported modules.

| Declaration | Exact fields |
| --- | --- |
| `export mask name` | `rows`: a nonempty shape of `1` and `.` |
| `export material name` | `ramp`: one of the two records below |
| `export stamp name` | `rows`, `slots`: exactly the used non-dot characters, without duplicates |

An explicit ramp has `mode = explicit; colors = [#shadow, #base, #light];` with
actual six-digit colors. The three colors must have nondecreasing luminance
and distinct endpoints. A generated ramp has `mode = generated; base = #rrggbb;`
and `preset = warm-v1;` or `neutral-v1`.

## Part shading and detail

| Record | Fields and values |
| --- | --- |
| `shade` | `form`: `flat`, `round`, `bevel`; `light`: `top_left`; `contrast`: integer 0–2 |
| Bevel `shade.axis` | Two distinct local pixel points inside the mask rectangle; required only for `bevel` |
| `grain` | `mode`: `clustered-v1`; `amount`: integer 0 or 1; `seed`: integer 0–4294967295 |
| Each patch | `id`, `at`, `rows`, `colors`, `protect`: integer 0–2 |

Patch coordinates are local to the part. Colored patch pixels must fall inside
occupied mask cells. A part may contain up to 16 patches. Sprite patches use
these literal records; they do not accept the model texture `anchor` syntax.

## Complete reusable sprite

Save as `badge.ashfox`. This file needs no imported module:

```ashfox
ashfox-model 1
sprite badge {
  export mask square { rows = ["1111", "1111", "1111", "1111"]; }
  export material metal {
    ramp { mode = explicit; colors = [#303030, #808080, #e0e0e0]; }
  }
  export stamp dot { rows = ["x"]; slots = ["x"]; }
  profile = "minecraft-item-v1";
  canvas = (16px, 16px);
  palette { accent = #ffd166; }
  part base {
    mask = square;
    material = metal;
    at = (6px, 6px);
    shade { form = flat; light = top_left; contrast = 1; }
    grain { mode = "clustered-v1"; amount = 0; seed = 42; }
    patches = [];
  }
  stamp mark { stamp = dot; at = (7px, 7px); flip = none; colors { x = accent; } }
  erase corner { at = (6px, 6px); rows = ["1"]; }
}
```

```sh
npx --no-install ashfox build badge.ashfox --json
```

See [the shared item module](../../examples/items/src/shared.ashfox) for more
masks, materials and stamps, and [workspace configuration](../guides/workspace.md)
to export a collection from one project.
