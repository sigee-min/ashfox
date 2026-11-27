# Create a model

A model source describes geometry, its surface, a rig/skeleton and the final asset
assembly. Add motion declarations for animated assets. Use the same source for a
general GLB or an appropriate Minecraft exporter.

## Start from a static prop

Start from `showcase/assets/models/wall_lantern.ashfox`, `showcase/assets/models/rune_bricks.ashfox`, or the [starter download](/downloads/starter.zip).
Inspect built-in standard-library modules with `ashfox library std list model` or `ashfox library std list core`.
From your asset folder:

```sh
npx --no-install ashfox check marker.ashfox
npx --no-install ashfox build marker.ashfox --json
npx --no-install ashfox render marker.ashfox --output marker-front.png
```

The GLB is the model for your engine; the PNG is an observation of it. Static
props do not need an idle animation. No workspace is required.

## Understand what to edit

| Declaration | Change it to… |
| --- | --- |
| `rig contract` | Define attachment joints and allowed motion channels |
| `skeleton` | Position joints in the rest pose |
| `surface contract` | Define texture charts and their required coverage |
| `surface` | Choose palette, PBR `roughness`/`metallic`, raster detail and material behavior |
| `component` | Create `cube`, `plane`, `taper`, `wedge`, `cylinder`, and `expression_slot` geometry bound to bones/surfaces |
| `motion` | Animate supported joint channels and facial `expression` schedules |
| `model` assembly | Select the skeleton, components and assigned motions; auto-fit physics `colliders` from `settings.profile` |

Every source begins with `ashfox 1`. File extensions are `.ashfox`.
Model lengths use `u`, pixel dimensions use `px`, times use `s`, and angles use
`deg`. Read [Model language syntax](../language/model.md) for complete
sources and legal values. Use [Dimensions and pixel detail](precision-modeling.md)
for shared design variables and exact resize relationships.

## Reference examples by profile

| Profile | Example | What it demonstrates |
| --- | --- | --- |
| `block` | `showcase/assets/models/rune_bricks.ashfox` | Single-cube 16×16×16 textured block without forced rotation or symmetry |
| `prop` | `showcase/assets/models/wall_lantern.ashfox` | Emissive cutout cage prop with `taper`/`wedge` brackets and PBR metallic sheen |
| `prop` | `showcase/assets/models/treasure_chest.ashfox` | Modular prop using `"std/model/prop/container"` and `std/core/hook/loot` hooks |
| `prop` | `showcase/assets/models/oak_tree.ashfox` | Nature foliage prop built from `"std/model/nature/tree"` + `"std/model/motion/nature"` (`wind_sway`) |
| `prop` | `showcase/assets/models/iron_helm.ashfox` | Socket-compatible plate helm importing `"std/model/armor/helm"` (`HeadHelmSocket`) |
| `prop` | `showcase/assets/models/scifi_drone.ashfox` | Sci-fi hover drone using `"std/model/rig/drone"` with bone-bound `hitzone` weakpoints |
| `creature` | `showcase/assets/models/zombie_walker.ashfox` | Survival zombie using `"std/model/rig/biped"`, `"std/model/motion/zombie"`, headshot `hitzone`, and `head_helm` socket |
| `creature` | `showcase/assets/models/goblin_raider.ashfox` | Biped creature built from `"std/model/rig/biped"`, `"std/model/motion/combat"`, expressions, and capsule collider |
| `creature` | `showcase/assets/models/goblin_pyromancer.ashfox` | Compact variant swap over shared `"std/*"` modules with flame staff and VFX/sound cues |
| `creature` | `showcase/assets/models/griffin_boss.ashfox` | Winged quadruped creature using `"std/model/rig/winged_quadruped"`, 3-tier swept eagle wings, lateral eyes, and secondary tail physics |
| `creature` | `showcase/assets/models/red_fox.ashfox` | Quadruped creature using `"std/model/rig/quadruped"`, `plane` cheek/tail tufts, 3-segment hindlegs, and tail spring physics |
| `structure` | `showcase/assets/structures/tavern.ashfox` | Multi-story timber tavern with furnished interior, radiosity GI, and `LootSpawn`/`DoorPortal` hooks |
| `structure` | `showcase/assets/structures/blacksmith.ashfox` | Stone-and-timber forge with open hearth, anvil interior, and chimney embers |
| `structure` | `showcase/assets/structures/modern_gallery.ashfox` | Modern glazed-atrium gallery with stained glass GI and contemporary display furnishings |
| `structure` | `showcase/assets/structures/scifi_airlock.ashfox` | Sci-fi facility bay using `"std/structure/arch/scifi"`, `"std/structure/interior/scifi"`, and `rust_streak` weathering |
| `structure` | `showcase/assets/structures/survival_outpost.ashfox` | Post-apoc survivor camp using `"std/structure/arch/postapoc"`, `"std/structure/interior/postapoc"`, `wall_breach`, and `vine_overgrowth` |
| `structure` | `showcase/assets/structures/dungeon_gate.ashfox` | Modular crypt gatehouse using `"std/structure/dungeon/{corridor,chamber,trap_gate}"` and `TrapPlate` hooks |

Multi-genre standard library kits under `std/model/` also provide `rig/{vehicle,mech,turret,drone,fps_arms}`, `motion/{vehicle,firearm,zombie,mech,nature}`, `armor/{helm,cuirass,shield}`, and `nature/{tree,foliage,rock,survival}` — inspect them via `ashfox library std list model`.

## Creature art direction (Do / Don't)

Use `ashfox library std list model` (`std/model/rig/*`, `std/model/anatomy/*`, `std/model/face/*`) as your craft baseline so every creature preserves heroic Hytale-grade voxel proportions:

| Rule | DO | DON'T |
| --- | --- | --- |
| **Silhouette & primitives** | Sculpt organic anatomy with hierarchical `cube` volumes, subtle `15deg`–`22.5deg` rotations, and thin `plane` accents (`cheek_tuft`, `tail_plume`, `crest_plume`, feather fringes, fins). | Never place large 45° `wedge` blocks on creature muzzles, snouts, jaws, chests, or boots/shoes. |
| **Specialty primitives** | Reserve `taper` for horns, claws, weapon tips, and cuffs; `wedge` for axe blades, pauldrons, armor horns, and roofs; `cylinder` for potions, pillars, shields, barrels, and wheels. | Never use a bare `cylinder` for a furry or feathered tail. |
| **Eyes & expressions** | Keep eye centers at `38%–64%` (`45%–55%` ideal) of skull height, and set `placement = lateral_pair` on `expression_slot` for birds, griffins, and dragons. | Never place eyes above `68%` skull height (forehead googly eyes) or crowd avian/griffin eyes onto the front face. |
| **Rig & limb fidelity** | Match the rig to real anatomy (`std/model/rig/winged_quadruped` for 4-legged winged beasts, `quadruped` for 4-legged beasts, `biped` for humanoids) with 4 grounded feet on quadrupeds and multi-segment articulated legs. | Never amputate legs, wings, or joints just to squeeze a creature onto the wrong rig, and never collapse wings into flat horizontal T-pose stubs. |
| **PBR albedo headroom** | Keep metallic (`>= 0.6`) base albedo luminance `>= 0.42` so steel/gold gleam under studio IBL, and keep matte (`< 0.2`) surfaces below `0.94` luminance. | Never author dark charcoal (`L < 0.42`) high-metallic steel blades or blown-out pure-white (`L > 0.94`) matte chests. |

## Create an animated creature

Extract [the game project](/downloads/game-assets.zip) and start with `models/workbench/`. Keep
`main.ashfox`, `animation.ashfox`, `surface.ashfox`, and `body.ashfox` together, and preserve the package/module
entries when copying them into a configured project. Reusing an imported module
requires its source file; the entry alone is not a complete backup.

Follow [Animation](animation.md) to assign named motions. General game bundles
list exported clip names and durations in `assets.json`. Gameplay code decides
when to play those clips. The CLI does not infer attack timing, movement states,
or sound-event bindings from animation names.

## Choose a destination

Use `format: glb` in `exports` for a general engine. `encoding: portable` is the
CLI default. `optimized` requires additional importer extensions. See
[Game assets](game-assets.md) for unit hints and runtime IDs.

For Minecraft, configure `namespace` and `modelPath` on a supported model export.
Java block is static; GeckoLib and Bedrock actor delivery require an idle clip.
Target-incompatible features fail rather than being silently dropped.
See [Output formats](choose-a-format.md).

## Review before shipping

Use `render --view <name>` with declared `preview` blocks for front, side, orbit, and motion GIF views.
Then import the generated GLB into your intended viewer or engine. Inspect silhouette,
face direction, texture seams, scale and attachments. For animation, watch every
clip through a full cycle. Validation cannot certify that a model looks correct
in your game's lighting or camera.
