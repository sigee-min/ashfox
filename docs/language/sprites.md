# Sprite syntax reference

A native sprite source produces a deterministic square PNG (`16×16`, `32×32`, or `64×64`, with `32×32` recommended). Supported profiles are `item`, `tile`, `icon`, and `decal`. See the [sprite walkthrough](../guides/sprites.md) for CPU audit, `preview inspect`, and build commands.

## Root and literal syntax

Write `ashfox-model 1` followed by `sprite name { … }`. Required root properties are `profile`, `canvas`, and `palette`; layers are named declarations in source order. Do not write generated `id`, `op`, `format`, or `layers` properties by hand.

| Form | Example |
| --- | --- |
| Assignment | `canvas = (32px, 32px);` |
| Nested record | `palette { glint = #ffffff; }` |
| List | `points = [(10, 15), (17, 22), (28, 11)];` |
| Empty list | `patches = [];` |
| Reference | `material = shared.steel;` |

Pixel dimensions (`canvas`, `at`, `axis`, shape coordinates/radii/thickness) accept non-negative integers (or `0.5`-stepped radii/centers on parametric shapes). Unitless controls (`contrast`, `specular`, `amount`, `density`, `jitter`, `seed`) forbid `px`. Strings follow the shared model lexer; bare or quoted enum/reference names are accepted.

## Layer declarations

Layer IDs are unique (`[a-z][a-z0-9_]{0,47}`) and render in source order:

| Layer | Fields | Semantics |
| --- | --- | --- |
| `fill name` | `material`, `pattern`, optional `grain` | Fill entire canvas with wrapping seamless pattern (`tile` workflows) |
| `shape name` | `shape`, `material`, `shade`, optional `grain`, `mirror`, `pattern`, `clip` | Rasterize shaded parametric shape (`rect`, `ellipse`, `capsule`, `polygon`, `line`) |
| `part name` | `mask`, `material`, `at`, `shade`, optional `grain`, `mirror`, `pattern`, `patches` | Shade a reusable mask with local protected patches |
| `pattern name` | `material`, `pattern`, optional `clip` (`occupied` or `canvas`) | Overlay 2D surface pattern (`solid`, `gradient`, `blotch`, `stripe`, `brick`, `plank`, `voronoi`, `dither`, `crack`) |
| `outline name` | `mode` (`sel_out`, `dark`, `colored`), optional `color`, `strength` (`1..3`), `innerRim` | Silhouette-aware pixel outline and top-left interior rim highlight |
| `paint name` | `at`, `rows`, `colors` | Paint palette-bound ASCII rows (`.` leaves pixel unchanged) |
| `stamp name` | `stamp`, `at`, `flip`, `colors` | Place a reusable pixel stamp (`none`, `x`, `y`, `xy`) |
| `erase name` | `shape` or (`at`, `rows`) | Cut out interior notches or holes cleanly |

## Reusable declarations and OKLCH ramps

Inside a sprite or imported sprite `module`, declare `export mask`, `export stamp`, or `export material`. Import relative modules with `import "./shared.ashfox" as shared;`.

- `mode = auto; base = #rrggbb; preset = <preset>;` generates a 5-stop OKLCH hue-shifted ramp (`warm`, `cool`, `metal`, `gem`, `wood`, `stone`, `organic`, `cloth`, `emissive`, `vivid`).
- `mode = explicit; colors = [#c0, #c1, #c2];` (or 5 colors) requires non-decreasing sRGB luminance and distinct endpoints. Keep shadow stops above relative luminance `0.14` to avoid crushed blacks.

## Shading and grain

- `shade`: `form` (`flat`, `round`, `bevel`, `cylinder`, `facet`), `light` (8 cardinal/diagonal directions, e.g. `top_left`), `contrast` (`0..3`), optional `specular` (`0..2`), and `axis` (2 distinct points for `bevel`/`cylinder`).
- `grain`: `mode` (`none`, `clustered`, `soft`, `directional` with `axis = horizontal | vertical | diagonal`), `amount` (`0..2`), `seed` (`0..4294967295`).

## Complete reusable sprite

Save as `badge.ashfox`:

```ashfox
ashfox-model 1
sprite badge {
  preview inspect { sheet = inspect; }
  export material gold { ramp { mode = auto; base = #e2ac48; preset = warm; } }
  export material ruby { ramp { mode = auto; base = #d9467a; preset = emissive; } }
  export material bronze { ramp { mode = auto; base = #b47448; preset = wood; } }
  profile = item;
  canvas = (32px, 32px);
  palette { glint = #ffffff; trim = #fff0b8; }
  shape shield {
    shape { kind = polygon; points = [(7, 5), (25, 5), (26, 17), (16, 28), (6, 17)]; }
    material = gold;
    shade { form = bevel; light = top_left; contrast = 3; specular = 2; axis = [(8, 8), (24, 24)]; }
    pattern { kind = gradient; axis = radial; toMaterial = bronze; dither = false; seed = 7; }
    grain { mode = clustered; amount = 1; seed = 11; }
  }
  shape inlay_gem {
    shape { kind = ellipse; cx = 16; cy = 15; rx = 5.5; ry = 6.5; }
    material = ruby;
    shade { form = facet; light = top_left; contrast = 3; specular = 2; }
    grain { mode = clustered; amount = 1; seed = 19; }
  }
  paint glint_dot {
    at = (13px, 11px);
    rows = ["gg", "g."];
    colors { g = glint; }
  }
  outline edge { mode = sel_out; strength = 2; innerRim = true; }
}
```

```sh
npx --no-install ashfox check badge.ashfox
npx --no-install ashfox render badge.ashfox --view inspect --output badge-sheet.png
npx --no-install ashfox build badge.ashfox --json
```

See [the shared item module](../../examples/items/assets/module/shared.ashfox) for more materials, [items examples](../../examples/items/.ashfoxworkspace) for 32×32 items and seamless tiles, and [workspace configuration](../guides/workspace.md) to export a collection from one project.
