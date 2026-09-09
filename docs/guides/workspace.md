# Configure your project

Native `.ashfox` files are the durable asset sources. A workspace is optional:
use a root `.ashfoxworkspace` only when a repository needs common source-selection,
package, ignore, build or export rules. It contains settings, never source or
compiled state. Model, sprite and sound files compile directly without it.

```sh
npx --no-install ashfox build fox.ashfox --json
```

Without an ancestor configuration, the CLI reads only the entry and its parsed
relative import closure, and writes `dist/<asset-id>/build` and
`dist/<asset-id>/exports` beside the entry. No workspace file is created. Modules
are dependencies, not build entries. Imports must stay beneath the entry folder;
package imports require a configured project. Unrelated files are not scanned.

The CLI searches upward for the nearest `.ashfoxworkspace`, stopping at the Git
root or filesystem root. When found, its complete project rules apply and the
project builds atomically, just as when passing the configuration explicitly.
Invalid configuration never silently falls back to standalone defaults.

```text
items/
  .ashfoxworkspace
  src/
    shared.ashfox
    apple.ashfox
    iron_sword.ashfox
  build/                  derived compiler output
  exports/                delivery artifacts
```

Download and extract [the complete item project](/downloads/items.zip). Its configuration is [`examples/items/.ashfoxworkspace`](../../examples/items/.ashfoxworkspace).
Its sources are under `examples/items/src/`. Keep the configuration and sources together in Git.

From the extracted example folder:

```sh
npx --no-install ashfox check .ashfoxworkspace --json
npx --no-install ashfox build .ashfoxworkspace --json
npx --no-install ashfox verify build --json
```

The CLI returns the immutable bundle and export paths. Resolve the selected build
through `build/current.json`; do not guess a bundle hash or select by modification
time. Generated `build/` and `exports/` folders are excluded from Git in this example.

## Root configuration

```json
{
  "format": "ashfox-workspace",
  "version": 2,
  "name": "my-items",
  "packages": [{
    "name": "items",
    "root": "src",
    "manifest": {
      "format": "ashfox-package",
      "version": 1,
      "entries": [{"name": "apple", "path": "apple.ashfox"}],
      "modules": [{"subpath": "./shared", "path": "shared.ashfox"}],
      "dependencies": []
    }
  }],
  "include": ["src/**/*.ashfox"],
  "ignore": ["src/drafts/**"],
  "build": {"directory": "build"},
  "exports": [{
    "name": "apple_png",
    "entry": {"packageName": "items", "entryName": "apple"},
    "format": "png",
    "directory": "exports/apple"
  }]
}
```

When supplied, the configuration has closed, required keys. The root owns source discovery, entry/module
registration, local package dependencies and delivery configuration. File paths
inside a package are relative to its root; include/ignore/build/export paths
are relative to the project root. Output destinations have no bearing on pixels
or model geometry. Changing them changes the project build identity.

`include` and `ignore` accept `*`, `**`, and `?`. A `**/` prefix also matches
zero directories. Ignore wins; there is no negation or implicit `.gitignore`
merge. `.git`, `node_modules`, `.ashfox`, build.directory and every export
directory are excluded from source selection. The root file itself is not a
source candidate. A declared entry/module must be included and not ignored;
ignore never silently disables a declared entry. Included undeclared `.ashfox`
files are rejected rather than compiled implicitly.

Roots and paths must be normalized and collision-free. Absolute paths, parent
traversal, backslashes, output overlap and output in reserved directories are
rejected. Source symlinks are rejected, and generated output is excluded from discovery. Output is owned only by the
configured destinations. Neither include nor ignore grants deletion authority.

The configuration allows PNG for sprites, GLB/Java block/GeckoLib 5/Bedrock for models and WAV for sounds.
Minecraft formats (`java_block`, `geckolib5`, `bedrock`) additionally require
`namespace` and extensionless `modelPath`.
See [export formats](choose-a-format.md). A mismatched
entry/format fails the entire candidate. Use only a format supported for the selected asset kind.

## Export settings

Every export requires `name`, `entry` (`packageName` and `entryName`), `format`,
and `directory`. Use `png` for sprites, `wav` for sounds and `glb` for general
models. A GLB export optionally accepts `encoding: portable|optimized`;
portable is the CLI default. Minecraft model exports require `namespace` and
extensionless `modelPath` in addition to the common fields.

Export, package and entry names start with a lowercase letter and contain only
lowercase letters, digits and underscores, up to 48 characters. Project names
also allow hyphens. Names identify assets; changing an export name requires
updating pack references to it.

## Compose game deliveries

There is no count limit on named exports or pack bindings. Keep related assets
in one workspace; splitting it is not required to export more than 64 assets.
The CLI's [execution budgets](cli.md#execution-limits) still apply.

Add the optional root `packs` array to compose exports. Use
[game assets](game-assets.md) for GLB/PNG/audio and a runtime manifest, or
[Minecraft packs](minecraft-packs.md) for Java resource paths and sound events.
Both may coexist. Pack names and export names must be unique together.
Each pack's `source` points to an export name, not a source filename.

The package declaration above is complete when copied alongside the apple and
shared module from the [sprite guide](sprites.md). Register every included source
as an entry or module. Keep modules reachable from entries; unused declarations
are errors. `dependencies` declares local package dependencies for model package
imports; it does not install remote packages. Sprite imports use relative paths.

## Predictable builds

The native CLI accepts configuration version 2 and external `.ashfox` sources.
Save content in source files and settings in the root configuration. Unknown
keys and source-embedded workspace objects are rejected.

Source selection is limited to 512 files / 8 MiB; configuration to 256 KiB and
filesystem scanning to 20,000 entries. Source symlinks are rejected. Split large
projects into separate configured roots rather than including generated trees.
See [CLI reference](cli.md) for execution limits and
[save and export](save-and-export.md) for publication, ownership and cleanup.
