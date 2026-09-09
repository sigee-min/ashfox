# Create a model

A model source describes geometry, its surface, a rig/skeleton and the final asset
assembly. Add motion declarations for animated assets. Use the same source for a
general GLB or an appropriate Minecraft exporter.

## Start from a static prop

The [marker source](../../examples/minecraft/marker.ashfox) is one complete file.
It is also included in the [starter download](/downloads/starter.zip).
From your asset folder:

```sh
npx --no-install ashfox inspect marker.ashfox
npx --no-install ashfox export marker.ashfox --output marker.glb
npx --no-install ashfox capture marker.ashfox --camera front --output marker-front.png
```

The GLB is the model for your engine; the PNG is an observation of it. Static
props do not need an idle animation. No workspace is required.

## Understand what to edit

| Declaration | Change it to… |
| --- | --- |
| `rig contract` | Define attachment joints and allowed motion channels |
| `skeleton` | Position joints in the rest pose |
| `surface contract` | Define texture charts and their required coverage |
| `surface` | Choose palette, raster detail and material behavior |
| `component` | Create cubes/planes and bind them to bones/surfaces |
| `motion` | Animate supported joint channels |
| `asset` assembly | Select the skeleton, components and assigned motions |

Every source begins with `ashfox-model 1`. File extensions are `.ashfox`.
Model lengths use `u`, pixel dimensions use `px`, times use `s`, and angles use
`deg`. Read [Model language syntax](../language/model.md) for complete
sources and legal values. Use [Dimensions and pixel detail](precision-modeling.md)
for shared design variables and exact resize relationships.

## Create an animated creature

Extract [the game project](/downloads/game-assets.zip) and start with `models/workbench/`. Keep
`main.ashfox` and `animation.ashfox` together, and preserve the package/module
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

Use `capture` for front, side and orbit views and `replay --clip NAME` for motion.
Then import the generated GLB into your intended viewer or engine. Inspect silhouette,
face direction, texture seams, scale and attachments. For animation, watch every
clip through a full cycle. Validation cannot certify that a model looks correct
in your game's lighting or camera.
