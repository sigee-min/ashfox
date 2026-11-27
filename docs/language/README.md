# Ashfox DSL reference

The Ashfox DSL is the source format for models, pixel textures, sounds, and structures.
This reference describes the unified `ashfox 1` language. Save source as UTF-8
`.ashfox` files. Generated GLB, PNG, WAV, NBT, and JSON files are outputs; edit
and version the source to change the asset.

## Find a specification

| Reference | Contents |
| --- | --- |
| [Values and expressions](values.md) | Lexical rules, closed types, operators, functions and design checks |
| [Model syntax](model.md) | Geometry, rig, skeleton, motion, assembly and a complete animated model |
| [Components and sockets](components.md) | Parameters, nominal ports, concrete bindings and attachment rules |
| [Model textures](textures.md) | Surface contracts, atlas charts, palettes, stamps and pixel coordinates |
| [Sprite syntax](sprites.md) | Native sprite records, reusable shapes, materials, layers and validation |
| [Sound syntax](sounds.md) | Literal records, source variants, field ranges and synthesis behavior |
| [VFX syntax](vfx.md) | Geometric VFX primitives, procedural textures, dissolve strips and particle emitters |
| [Structure syntax](structures.md) | Minecraft `.nbt` & Unity GLB buildings, palettes, prefabs, roofs and cutaway views |
| [Hooks and schemas](hooks.md) | Modular `schema`, `anchor`, `volume`, `cue`, `meta`, `zone`, `.hooks.json` and engine bindings |

For projects with multiple assets, see [workspace configuration](../guides/workspace.md).
It is a separate JSON contract, not a wrapper required around every source file.
Reuse built-in standard-library modules via `import "std/..."` (browse with `ashfox library std list`), or query offline syntax pages with `ashfox docs <topic>`.
For complete creation walkthroughs, see [models](../guides/models.md),
[sprites](../guides/sprites.md), [vfx](../guides/vfx.md) and [sounds](../guides/sounds.md).

## Source shapes

Every file starts with the header `ashfox 1` and contains one outer unit.
The header identifies the unified language version across all five asset kinds.

| Outer unit | Meaning | Allowed content |
| --- | --- | --- |
| `model Name { … }` | Model entry | Imports, designs, contracts, skeletons, surfaces, components, motions and assembly (`settings`, `skeleton`, `motions`, `use`, `connect`) |
| `module Name { … }` | Reusable model declarations | Imports and exported/private model declarations |
| `sprite name { … }` | One pixel sprite | Imports, reusable sprite declarations, profile, canvas, palette and layers |
| `module name { … }` used by a sprite | Reusable sprite declarations | Imports and exported masks, materials and stamps |
| `vfx name { … }` | One stylized VFX effect | Imports, duration, fps, loop, palette, geometric `element`s and `voxel_burst` `emitter`s |
| `sound name { … }` | One sound effect | Audio properties, space, voices, sequences, variants, loop and mastering settings |
| `structure id { … }` | One Minecraft / GLB building | Block-state palette, custom `.ashfox` props, prefabs, roofs, cutaway & interior ops |
| `module id { … }` used by a structure | Reusable building interiors | Optional palette and `export prefab` interior modules |

A model entry's `model Name { … }` block holds declarations alongside the top-level
assembly (`settings`, `skeleton`, `motions`, `use`, `connect`). Sprites, sounds, and structures
likewise place their properties directly inside their outer unit. Shared `module` declarations
follow their domain context; importing a module does not convert it into another asset kind.

## Domain syntax summary

| Feature | Models | Sprites | Sounds | Structures |
| --- | --- | --- | --- | --- |
| Compile-time iteration | Static `for i in a..b` + `${i}` | Static `for i in a..b` + `${i}` | `variants` | Static `for i in a..b` + `${i}` |
| --- | --- | --- | --- | --- |
| Arithmetic and typed designs | Supported | Not supported | Not supported | Integer/block `params` math |
| Numeric spelling | Exact decimals with `u`, `px`, `deg`, `s`, or `%`/plain ratios | `px` coordinates/sizes/radii/axes and unitless/`%` controls | Typed `s`, `ms`, `hz`, `khz`, `db`, `lufs`, `cents`, `st`, `%`, ranges `a..b`, transitions `a -> b` | `b` block coords/sizes, `%` or decimal rates/weights |
| Collections | Typed tuples/vectors `(a, b, c)` | Lists `[a, b]` and `{ k = v; }` blocks | `{ k = v; }` blocks and point lists | `{ k = v; }` blocks and target lists |
| Imports | Explicit aliases and exported declarations | Relative imports of sprite declarations | Modular `sound` / `module` declarations | Relative/package imports for models and prefabs |
| Comments | `//` and `/* … */` | `//` and `/* … */` | `//` and `/* … */` | `//` and `/* … */` |

Do not copy model expressions into sprite, sound, or structure properties. For example,
model `duration = 1s;` and sound `duration = 1s;` both write seconds, while structure
`size = (9b, 13b, 9b);` uses block units (`b`).
The language supports parameterized `component` modules (`param name : type = default;`), deterministic compile-time `for i in start..end` unrolling with `${i}` identifier interpolation (capped at `128` iterations per loop and nesting depth `3`), and `variant name { ... }` model matrices; it has no runtime loops, recursion, or automatic attachment inference. Reuse components, modules, and explicit imports.

## Compile and diagnose

```sh
npx --no-install ashfox check sample.ashfox --json
npx --no-install ashfox build sample.ashfox --json
```

A standalone entry compiles its explicit import closure. In an ancestor
workspace, the configuration controls selection and output paths. Find output
directories in the build response rather than guessing filenames.

| Failure | What to inspect |
| --- | --- |
| Syntax error | Header, enclosing unit, braces, property spelling and semicolons |
| Unknown or private name | Import alias, declaration export and exact name |
| Type or unit mismatch | Expected field type and every operand's suffix |
| Chart mismatch or off-grid pixels | Geometry dimensions, chart net, atlas placement and stamp bounds |
| Rig or socket mismatch | Nominal contract identity, complete binds and explicit connections |
| Named design check failed | The authored relationship; checks do not repair geometry |
| Unused code or mixed modules | Remove dead imports, declarations, or stamps; split multi-concern modules |

Diagnostics include source locations or field pointers. Fix the earliest source
error before interpreting downstream errors. A successful compile validates the
contract; use captures and playback to judge appearance and motion.

Code blocks marked `ashfox` in this reference are complete executable files.
Blocks marked `text` are fragments or grammar sketches whose surrounding
contracts must be supplied. The documentation tests compile, build and verify
complete examples. See [troubleshooting](../guides/troubleshooting.md) for CLI failures.
