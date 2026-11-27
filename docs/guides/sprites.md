# Create item sprites and tiles

Sprite sources produce deterministic square PNGs (`16×16`, `32×32`, or `64×64`) for items, seamless tiles, icons, and decals, with a pure-CPU quality audit and 4-panel `preview inspect { sheet = inspect; }` sheet.

## Build a complete sprite

Save this complete source as `gem.ashfox` outside an ancestor workspace:

```ashfox
ashfox 1
sprite gem {
  preview inspect { sheet = inspect; }
  export material amethyst { ramp { mode = auto; base = #9c60cc; preset = gem; } }
  export material prism { ramp { mode = auto; base = #df9cf8; preset = emissive; } }
  export material stone_base { ramp { mode = auto; base = #767c8a; preset = stone; } }
  profile = item;
  canvas = (32px, 32px);
  palette { glint = #ffffff; }
  capsule base_rock {
    from = (9px, 23px); to = (23px, 23px); radius = 3.5px;
    material = stone_base;
    shade { form = round; light = top_left; contrast = 2; }
    grain { mode = clustered; amount = 1; seed = 7; }
  }
  polygon spire {
    points = [(11px, 22px), (12px, 7px), (16px, 4px), (20px, 7px), (21px, 22px)];
    material = amethyst;
    shade { form = facet; light = top_left; contrast = 3; specular = 2; }
    pattern gradient { axis = y; to_material = prism; dither = false; seed = 11; }
    grain { mode = clustered; amount = 1; seed = 13; }
  }
  paint glint_dot {
    at = (14px, 7px);
    rows = [".g", "gg"];
    colors { g = glint; }
  }
  outline edge { mode = sel_out; strength = 2; inner_rim = true; }
}
```

```sh
npx --no-install ashfox check gem.ashfox
npx --no-install ashfox render gem.ashfox --view inspect --output gem-sheet.png
npx --no-install ashfox build gem.ashfox --json
```

Use the export directory from the response containing `gem.png`. Delivery (`build`) verifies `audit.passed === true` (`score >= 75`, target `>= 85`).

## Compose with OKLCH ramps, shapes, patterns, and outlines

- **Direct shapes & `part`**: Compose silhouettes directly with `rect`, `ellipse`, `capsule`, `polygon`, and `line` blocks or reusable `part` masks, shaded with `flat`, `round`, `bevel`, `cylinder`, or `facet` light forms and specular highlights.
- **OKLCH ramps**: `ramp { mode = auto; base = #...; preset = ...; }` automatically generates 5 hue-shifted stops (warmer highlights, cooler shadows) across 10 presets (`warm`, `cool`, `metal`, `gem`, `wood`, `stone`, `organic`, `cloth`, `emissive`, `vivid`).
- **`sel_out` & `inner_rim`**: `outline` draws hue/value-modulated selective pixel outlines (`strength = 1..3`) and subtle top-left interior rim highlights without flat black borders.
- **Seamless tiles (`profile = tile`)**: Use `fill` and `pattern` layers (`brick`, `plank`, `voronoi`, `blotch`, `stripe`, `gradient`, `dither`, `crack`) which wrap toroidally across canvas edges.

Start with `showcase/assets/sprites/iron_sword.ashfox`, `showcase/assets/sprites/ruby_potion.ashfox`, `showcase/assets/sprites/oak_planks.ashfox`, and the built-in sprite standard library (`ashfox library std list sprite`) for complete item and tile examples. Keep project-specific shared sprite modules under `assets/module/` when shared across multiple sprites in a workspace.

## Review pixels and audit craft

```sh
npx --no-install ashfox render gem.ashfox --view inspect --output gem-sheet.png
npx --no-install ashfox check gem.ashfox
```

Declaring `preview inspect { sheet = inspect; }` renders a 512×512 4-panel sheet on the CPU (no browser needed):

- **Items / icons / decals**: `1x + scaled preview`, `silhouette`, `value (luminance)`, and `palette + audit score`.
- **Tiles**: `1x tile`, `3×3 seamless repeat`, `value (luminance)`, and `palette + audit score`.

See [observation controls](observe.md) for `stage` (`final`, `silhouette`, `shade`, `grain`) and `scale` previews, and [Minecraft packs](minecraft-packs.md) or [game assets](game-assets.md) for pack binding.
