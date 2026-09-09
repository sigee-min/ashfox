# Ashfox DSL reference

The Ashfox DSL is the source format for models, pixel textures and sounds.
This reference describes the implemented `ashfox-model 1` language shipped with
Ashfox 1.0.0. Save source as UTF-8 `.ashfox` files. Generated GLB, PNG and WAV
files are outputs; edit and version the source to change the asset.

## Find a specification

| Reference | Contents |
| --- | --- |
| [Values and expressions](values.md) | Lexical rules, closed types, operators, functions and design checks |
| [Model syntax](model.md) | Geometry, rig, skeleton, motion, assembly and a complete animated model |
| [Components and sockets](components.md) | Parameters, nominal ports, concrete bindings and attachment rules |
| [Model textures](textures.md) | Surface contracts, atlas charts, palettes, stamps and pixel coordinates |
| [Sprite syntax](sprites.md) | Native sprite records, reusable shapes, materials, layers and validation |
| [Sound syntax](sounds.md) | Literal records, source variants, field ranges and synthesis behavior |

For projects with multiple assets, see [workspace configuration](../guides/workspace.md).
It is a separate JSON contract, not a wrapper required around every source file.
For complete creation walkthroughs, see [models](../guides/models.md),
[sprites](../guides/sprites.md) and [sounds](../guides/sounds.md).

## Source shapes

Every file has the header `ashfox-model 1` and exactly one outer unit.
The header identifies the language version for all three asset kinds.

| Outer unit | Meaning | Allowed content |
| --- | --- | --- |
| `asset Name { … }` | Model entry | Imports, designs, contracts, skeletons, surfaces, components, motions and exported asset assembly |
| `module Name { … }` | Reusable model declarations | Imports and exported/private model declarations |
| `sprite name { … }` | One pixel sprite | Imports, reusable sprite declarations, profile, canvas, palette and layers |
| `module name { … }` used by a sprite | Reusable sprite declarations | Imports and exported masks, materials and stamps |
| `sound name { … }` | One sound effect | Literal sound properties, layers, variants and output settings |

A model's outer `asset` unit is the source namespace. Its inner
`export asset` declaration is the buildable assembly. A sprite or sound needs
no inner assembly. Model and sprite modules share a keyword but have different
contents; importing a module does not convert it into the other asset kind.

## The three value grammars

| Feature | Models | Sprites | Sounds |
| --- | --- | --- | --- |
| Arithmetic and typed designs | Supported | Not supported | Not supported |
| Numeric spelling | Exact decimal, explicit units such as `u`, `px`, `deg`, `s`, `ratio` | Nonnegative integers; `px` also allowed for `at`, `canvas`, `axis` | Signed JSON-style decimals, including exponents; no unit suffixes |
| Collections | Typed tuples/vectors | Literal lists and records | Literal lists and records |
| Imports | Explicit aliases and exported declarations | Relative imports of sprite declarations | Not supported |
| Comments | `//` and `/* … */` | `//` and `/* … */` | `//` only |

Do not copy model expressions into sprite or sound properties. For example,
model `duration = 1s;` and sound `duration = 1;` belong to different readers.
The language has no user-defined functions, loops, inheritance, runtime code,
or automatic attachment inference. Reuse model components and explicit imports.

## Compile and diagnose

```sh
npx --no-install ashfox check sample.ashfox --json
npx --no-install ashfox build sample.ashfox --json
npx --no-install ashfox inspect sample.ashfox
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

Diagnostics include source locations or field pointers. Fix the earliest source
error before interpreting downstream errors. A successful compile validates the
contract; use captures and playback to judge appearance and motion.

Code blocks marked `ashfox` in this reference are complete executable files.
Blocks marked `text` are fragments or grammar sketches whose surrounding
contracts must be supplied. The documentation tests compile, build and verify
complete examples. See [troubleshooting](../guides/troubleshooting.md) for CLI failures.
