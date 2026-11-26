# Create item sprites and tiles

Sprite sources produce deterministic square PNGs (`16×16`, `32×32`, or `64×64`) for items, seamless tiles, icons, and decals, with a pure-CPU quality audit and 4-panel `preview inspect { sheet = inspect; }` sheet.

## Build a complete sprite

Save this complete source as `gem.ashfox` outside an ancestor workspace:

```ashfox
ashfox-model 1
sprite gem {
  preview inspect { sheet = inspect; }
  export material amethyst { ramp { mode = auto; base = #9c60cc; preset = gem; } }
  export material prism { ramp { mode = auto; base = #df9cf8; preset = emissive; } }
  export material stone_base { ramp { mode = auto; base = #767c8a; preset = stone; } }
  profile = item;
  canvas = (32px, 32px);
  palette { glint = #ffffff; }
  shape base_rock {
    shape { kind = capsule; x1 = 9; y1 = 23; x2 = 23; y2 = 23; radius = 3.5; }
    material = stone_base;
    shade { form = round; light = top_left; contrast = 2; }
    grain { mode = clustered; amount = 1; seed = 7; }
  }
  shape spire {
    shape { kind = polygon; points = [(11, 22), (12, 7), (16, 4), (20, 7), (21, 22)]; }
    material = amethyst;
    shade { form = facet; light = top_left; contrast = 3; specular = 2; }
    pattern { kind = gradient; axis = y; toMaterial = prism; dither = false; seed = 11; }
    grain { mode = clustered; amount = 1; seed = 13; }
  }
  paint glint_dot {
    at = (14px, 7px);
    rows = [".g", "gg"];
    colors { g = glint; }
  }
  outline edge { mode = sel_out; strength = 2; innerRim = true; }
}
```

```sh
npx --no-install ashfox check gem.ashfox
npx --no-install ashfox render gem.ashfox --view inspect --output gem-sheet.png
npx --no-install ashfox build gem.ashfox --json
```

Use the export directory from the response containing `gem.png`. Delivery (`build`) verifies `audit.passed === true` (`score >= 75`, target `>= 85`).

## Compose with OKLCH ramps, shapes, patterns, and outlines

- **`shape` & `part`**: Compose silhouettes from parametric `rect`, `ellipse`, `capsule`, `polygon`, and `line` primitives or reusable masks, shaded with `flat`, `round`, `bevel`, `cylinder`, or `facet` light forms and specular highlights.
- **OKLCH ramps**: `ramp { mode = auto; base = #...; preset = ...; }` automatically generates 5 hue-shifted stops (warmer highlights, cooler shadows) across 10 presets (`warm`, `cool`, `metal`, `gem`, `wood`, `stone`, `organic`, `cloth`, `emissive`, `vivid`).
- **`sel_out` & `innerRim`**: `outline` draws hue/value-modulated selective pixel outlines (`strength = 1..3`) and subtle top-left interior rim highlights without flat black borders.
- **Seamless tiles (`profile = tile`)**: Use `fill` and `pattern` layers (`brick`, `plank`, `voronoi`, `blotch`, `stripe`, `gradient`, `dither`, `crack`) which wrap toroidally across canvas edges.

Start with [iron_sword.ashfox](../../examples/items/assets/sprites/iron_sword.ashfox), [mossy_stone.ashfox](../../examples/items/assets/sprites/mossy_stone.ashfox), and [shared.ashfox](../../examples/items/assets/module/shared.ashfox) for complete item and tile examples. Keep shared sprite modules under `assets/module/` when shared across multiple sprites in a workspace.

## Review pixels and audit craft

```sh
npx --no-install ashfox render gem.ashfox --view inspect --output gem-sheet.png
npx --no-install ashfox check gem.ashfox
```

Declaring `preview inspect { sheet = inspect; }` renders a 512×512 4-panel sheet on the CPU (no browser needed):

- **Items / icons / decals**: `1x + scaled preview`, `silhouette`, `value (luminance)`, and `palette + audit score`.
- **Tiles**: `1x tile`, `3×3 seamless repeat`, `value (luminance)`, and `palette + audit score`.

See [observation controls](observe.md) for `stage` (`final`, `silhouette`, `shade`, `grain`) and `scale` previews, and [Minecraft packs](minecraft-packs.md) or [game assets](game-assets.md) for pack binding.
