# VFX syntax reference

Native VFX files use `ashfox 1` followed by `vfx <name> { ... }` or shared `module <name> { ... }` palette modules.

## Root contract

| Declaration / field | Contract |
| --- | --- |
| `duration` | Effect duration in seconds (for example `0.65s`) |
| `fps` | Integer playback sample rate |
| `loop` | `once` or `loop` |
| `palette` | Palette reference (`pal.Name`) or inline `palette { core = #...; mid = #...; edge = #...; smoke = #...; }` |
| `import` | Shared palette module (`import "../module/palettes.ashfox" as pal;`) |
| `preview` | Named capture views (`time`, `sheet = flipbook`, `background = dark | studio | transparent`, `width`, `height`) |
| `element <id> : <primitive>` | Procedural geometry element (`slash_arc`, `ribbon`, `ring`, `beam`, `dome`) |
| `emitter <id> : voxel_burst` | Deterministic particle simulation emitter |

## Geometric elements (`element <id> : <primitive>`)

Common properties inside `element`: `at = <start>..<end>;`, `blend = additive | blend | premul;`, `texture <kind> { ... }`, `dissolve <mode> { ... }`, `position`, `rotation`, `scale`, `alpha`, `color` / `color_over_life`.

- **Primitives**:
  - `: slash_arc` — `radius = inner..outer;`, `arc = startDeg..endDeg;`, `pitch`, `segments`, `tip_taper`, `crossed`
  - `: ribbon` — `points = [(x, y, z), ...];`, `width = start..end;`, `profile = crossed | tube;`
  - `: ring` — `radius = inner..outer;`, `segments`, `bevel_height`, `ripple_amp`, `ripple_freq`
  - `: beam` — `start = (x, y, z);`, `end = (x, y, z);`, `width`, `style = column | lightning;`, `jagged_amp`, `forks`, `fork_depth`, `seed`
  - `: dome` — `shape = hemisphere | sphere | cone | torus;`, `radius`, `inner_radius`, `height`, `subdiv = 1 | 2;`
- **Procedural textures (`texture <kind>`)**: `slash_streak`, `radial_flare`, `starburst`, `ring_wave`, `magic_circle`, `stylized_smoke` (`width`, `height`, `posterize`, `bristles`, `spikes`, `runes`, `rings`, `curl_scale`, `tint`, `seed`).
- **Dissolve strips (`dissolve <mode>`)**: `voronoi`, `simplex`, `directional_wipe`, `radial_noise` (`frames`, `edge_width`, `edge_glow = core | mid | edge | smoke;`, `direction`, `seed`).

## Particle emitters (`emitter <id> : voxel_burst`)

Inside `emitter`: `at = <start>..<end>;`, `seed`, `count`, `shape` (`point`, `cone(angle, radius)`, `sphere(radius)`, `ring(radius[, inner])`, `box(x, y, z)`, `arc(sweep, radius)`), `particle = voxel_cube | shard | puff | cross_card;`, `speed = min..max;`, `life = min..max;`, `gravity`, `drag`, `turbulence = curl(freq, amp);`, `vortex { axis; center; strength; radial_pull; }`, `ground { y; bounce; friction; }`, `size_over_life`, `color_over_life`, `velocity_stretch`, and `blend`.

See [VFX creation and review](../guides/vfx.md) for authoring workflow, flipbook capture, and delivery details.
