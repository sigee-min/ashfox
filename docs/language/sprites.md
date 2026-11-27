# Sprite syntax reference

A native sprite source produces a deterministic square PNG (`16×16`, `32×32`, or `64×64`, with `32×32` recommended). Supported profiles are `item`, `tile`, `icon`, `ui_9slice`, `crosshair`, `hud_bar`, and `decal`. See the [sprite walkthrough](../guides/sprites.md) for CPU audit, `preview inspect`, and build commands.

## Root and literal syntax

Write `ashfox 1` followed by `sprite name { … }`. Required root properties are `profile`, `canvas`, and `palette`; layers are named declarations in source order. Do not write generated `id`, `op`, `format`, or `layers` properties by hand. Optional `slice = (left, right, top, bottom);` (for `ui_9slice`, in `px`) emits a companion `<target>.sprite.json` with `{ nineSlice: { left, right, top, bottom } }`. Layer opacity `alpha` (`0..1`), shape edge `feather` (in `px`), and 8-digit hex `#rrggbbaa` palette colors enable soft compositing for `decal` sprites.

| Form | Example |
| --- | --- |
| Assignment | `canvas = (32px, 32px);` |
| Nested record | `palette { glint = #ffffff; }` |
| List | `points = [(10px, 15px), (17px, 22px), (28px, 11px)];` |
| Empty list | `patches = [];` |
| Reference | `material = shared.steel;` |

Pixel coordinates and dimensions (`canvas`, `at`, `axis`, shape points/positions/radii/thickness) use `px` (integers or `0.5px`-stepped centers/radii on parametric shapes). Unitless controls (`contrast`, `specular`, `amount`, `density`, `jitter`, `seed`) forbid `px` (percent `%` is supported for fractional ratios). Unquoted `snake_case` enum names and identifiers are standard.

## Layer declarations

Layer IDs are unique (`[a-z][a-z0-9_]{0,47}`) and render in source order:

| Layer | Fields | Semantics |
| --- | --- | --- |
| `fill name` | `material`, `pattern`, optional `grain` | Fill entire canvas with wrapping seamless pattern (`tile` workflows) |
| `rect`/`ellipse`/`capsule`/`polygon`/`line name` | geometry fields, `material`, `shade`, optional `grain`, `mirror`, `pattern`, `clip` | Rasterize shaded parametric shape directly (`points`, `cx`/`cy`/`rx`/`ry`, `from`/`to`/`radius`, etc.) |
| `part name` | `mask`, `material`, `at`, `shade`, optional `grain`, `mirror`, `pattern`, `patches` | Shade a reusable mask with local protected patches |
| `pattern name` | `material`, `pattern`, optional `clip` (`occupied` or `canvas`) | Overlay 2D surface pattern (`solid`, `gradient`, `blotch`, `stripe`, `brick`, `plank`, `voronoi`, `dither`, `crack`) |
| `outline name` | `mode` (`sel_out`, `dark`, `colored`), optional `color`, `strength` (`1..3`), `inner_rim` | Silhouette-aware pixel outline and top-left interior rim highlight |
| `paint name` | `at`, `rows`, `colors` | Paint palette-bound ASCII rows (`.` leaves pixel unchanged) |
| `stamp name` | `stamp`, `at`, `flip`, `colors` | Place a reusable pixel stamp (`none`, `x`, `y`, `xy`) |
| `erase name` | nested `shape` or (`at`, `rows`) | Cut out interior notches or holes cleanly |

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
ashfox 1
sprite badge {
  preview inspect { sheet = inspect; }
  export material gold { ramp { mode = auto; base = #e2ac48; preset = warm; } }
  export material ruby { ramp { mode = auto; base = #d9467a; preset = emissive; } }
  export material bronze { ramp { mode = auto; base = #b47448; preset = wood; } }
  profile = item;
  canvas = (32px, 32px);
  palette { glint = #ffffff; trim = #fff0b8; }
  polygon shield {
    points = [(7px, 5px), (25px, 5px), (26px, 17px), (16px, 28px), (6px, 17px)];
    material = gold;
    shade { form = bevel; light = top_left; contrast = 3; specular = 2; axis = [(8px, 8px), (24px, 24px)]; }
    pattern gradient { axis = radial; to_material = bronze; dither = false; seed = 7; }
    grain { mode = clustered; amount = 1; seed = 11; }
  }
  ellipse inlay_gem {
    cx = 16px; cy = 15px; rx = 5.5px; ry = 6.5px;
    material = ruby;
    shade { form = facet; light = top_left; contrast = 3; specular = 2; }
    grain { mode = clustered; amount = 1; seed = 19; }
  }
  paint glint_dot {
    at = (13px, 11px);
    rows = ["gg", "g."];
    colors { g = glint; }
  }
  outline edge { mode = sel_out; strength = 2; inner_rim = true; }
}
```

```sh
npx --no-install ashfox check badge.ashfox
npx --no-install ashfox render badge.ashfox --view inspect --output badge-sheet.png
npx --no-install ashfox build badge.ashfox --json
```

See `showcase/assets/sprites/` (`iron_sword.ashfox`, `ruby_potion.ashfox`, `oak_planks.ashfox`), built-in `"std/sprite/..."` modules (`ashfox library std list sprite`), and [workspace configuration](../guides/workspace.md) to export a collection from one project.
