# Create and review stylized VFX

Write stylized, game-ready visual effects in native `.ashfox` source (`ashfox 1`, `vfx <id>`) and compile them with the CLI. Each effect delivers triple runtime output (`.glb` with `KHR_materials_unlit` and `extras.ashfoxBlendMode`, `.vfx.json` shader/timing recipe, and `.particle.json` baked simulation), alongside optional 2D flipbook sprite sheets (`sheet = flipbook`).

## Author a stylized VFX effect

```ashfox
ashfox 1
vfx flame_cleave {
  duration = 0.65s;
  fps = 30;
  loop = once;
  palette { core = #fff6d6; mid = #ff9f38; edge = #e34224; smoke = #4a2a24; }

  preview flipbook { sheet = flipbook; background = dark; width = 512; height = 512; }
  preview peak { time = 0.22s; background = dark; azimuth = 35; elevation = 24; width = 640; height = 480; }

  element main_slash : slash_arc {
    at = 0.08s..0.38s;
    blend = additive;
    radius = 7u..18u;
    arc = -85deg..105deg;
    pitch = 16deg;
    crossed = true;
    texture slash_streak { posterize = 4; bristles = 60%; seed = 11; }
    dissolve directional_wipe { frames = 9; edge_glow = core; }
    scale = 0.72 -> 1.08 ease_out -> 1.18;
    alpha = 0.4 -> 1.0 snap -> 0.0 ease_in;
  }

  emitter sparks : voxel_burst {
    at = 0.10s..0.60s;
    seed = 42;
    count = 28;
    shape = cone(55deg, 3u);
    particle = shard;
    speed = 18u..34u;
    life = 0.25s..0.52s;
    gravity = -28u;
    drag = 1.4;
    turbulence = curl(1.8, 7u);
    ground { y = 0u; bounce = 45%; friction = 70%; }
    size_over_life = 1.2u -> 0.9u -> 0u;
    color_over_life = core -> mid -> edge;
    velocity_stretch = 1.4;
    blend = additive;
  }
}
```

```sh
npx --no-install ashfox check flame_cleave.ashfox
npx --no-install ashfox render flame_cleave.ashfox --view peak --output flame-peak.png
npx --no-install ashfox render flame_cleave.ashfox --view flipbook --output flame-sheet.png
npx --no-install ashfox build flame_cleave.ashfox --json
```

## Craft, blend, and runtime budgets

1. **Layered readability**: Combine crisp geometric elements (`slash_arc`, `ribbon`, `ring`, `beam`, `dome`) with deterministic `emitter` particle bursts, quantized color palettes (`core` -> `mid` -> `edge` -> `smoke`), and sharp dissolve silhouettes (`voronoi`, `simplex`, `directional_wipe`, `radial_noise`).
2. **Blend modes & soft alpha**: Use `blend = additive` for fiery or arcane cores, `blend = premul` or `blend = blend` for soft smoke and impact dust. Exporters emit `KHR_materials_unlit` and `extras.ashfoxBlendMode` with 8-bit soft-alpha textures.
3. **Inspect flipbooks & peak frames**: Declare `preview flipbook { sheet = flipbook; }` for a sprite-sheet grid plus `.flipbook.json` metadata, and render single `time = ...` views with `background = dark` or `transparent` to verify silhouette timing.
4. **Budget targets & stdlib recipes**: Built `.glb` artifacts stay within stylized game limits (`<= 4` draws, `<= 2,500` triangles, `<= 150 KB`). Reuse parameterized `std/vfx/*` recipes via `use` (`std/vfx/weapon/plasma_bolt`, `std/vfx/shield/*`, `std/vfx/magic/*`, `std/vfx/weather/*`, `std/vfx/impact/*`) — inspect `showcase/assets/vfx/plasma_bolt.ashfox`.

See [VFX syntax reference](../language/vfx.md) for the full `ashfox 1` VFX grammar and block options.
