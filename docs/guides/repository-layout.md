# Organize an asset repository

Use one source tree, one generated tree and one adapter between the asset build
and the game. Ashfox's recommended convention is `asset/` for authored input and
root `build/` for disposable output. The directory names are defaults, not reserved
keywords. The workspace defines the project's actual paths.

Executable workspaces and the grouped `init` template described here are available
from CLI 2.0.0. An older installed
1.0.0 archive does not acquire them automatically. Existing JSON workspaces remain
supported; do not replace a pinned archive without updating its checksum or lock.

## Start with the convention

```sh
ashfox init my-game
cd my-game
```

The starter is offline and refuses an existing destination. Install the CLI at
this project root using the [installation guide](install.md); commit the package
and lock files. Do not create a separate npm project inside each asset group.

```text
my-game/
  .ashfoxworkspace.mjs       executable build configuration, tracked
  .gitignore                ignores /build/ and /node_modules/
  assets.mjs                game build adapter, tracked
  asset/
    creatures/fox/
      fox.ashfox            model entry
      body.ashfox           imported geometry module
      rig.ashfox            imported skeleton and motions
      surface.ashfox        imported appearance module
    items/
      sword.ashfox          sprite entry
      shared.ashfox         imported sprite module
    sounds/
      claw_hit.ashfox       sound entry
  build/
    assets/
      compiler/             canonical bundles and current.json
      exports/
        creatures/fox/      immutable delivery bundles
        items/iron_sword/
        sounds/claw_hit/
```

Keep source, imported modules, workspace code, integration code and toolchain
locks in Git. Keep compiler receipts, exports, generated language bindings,
review captures and caches under `build/`, outside Git. Hand-authored reference
images belong in a tracked source/reference folder; do not ignore PNG globally.
A clean checkout plus the pinned toolchain must rebuild everything in `build/`.

## Write build policy in the workspace

`.ashfoxworkspace` is portable JSON. `.ashfoxworkspace.mjs` is executable Node ESM
that exports the same version-2 workspace object as its default export. Choose
one per root. A repository containing both is rejected rather than choosing one
silently. A source build searches upward for either form, stopping at the Git root.
Observation commands retain their source-only behavior.

```js
const items = [
  { name: 'iron_sword', path: 'sword.ashfox' },
];

export default {
  format: 'ashfox-workspace', version: 2, name: 'my-game',
  packages: [{
    name: 'items', root: 'asset/items',
    manifest: {
      format: 'ashfox-package', version: 1,
      entries: items,
      modules: [{ subpath: './shared', path: 'shared.ashfox' }],
      dependencies: [],
    },
  }],
  include: ['asset/items/**/*.ashfox'], ignore: ['build/**'],
  build: { directory: 'build/assets/compiler' },
  exports: items.map(item => ({
    name: `items_${item.name}`,
    entry: { packageName: 'items', entryName: item.name },
    format: 'png', directory: `build/assets/exports/items/${item.name}`,
  })),
};
```

This is a complete item-only configuration for the starter's item sources. The
full starter uses the same mapping pattern for models and sounds. Add `packs`
for [game manifests](game-assets.md) or [Minecraft deliveries](minecraft-packs.md).
Use ordinary imports and functions to factor configuration policy. Export an
object, not a callback. Functions may construct that object; functions inside
the exported data are not a supported configuration contract.

Executable configuration is trusted project code with normal Node permissions,
not sandboxed asset DSL. It runs for check/build, including source builds that
find it in an ancestor. Review it and its imports before running an unfamiliar
repository. Keep stdout reserved for the evaluator; use stderr for diagnostics.
Evaluation runs in the workspace root, with a 10-second timeout and 256 KiB
captured-output limit. Unknown settings and invalid paths still fail the closed
workspace reader. JSON remains the option for non-executable configuration.

Do not use timestamps, randomness, network responses or unpinned environment
values to select assets. The evaluated configuration and selected source bytes
participate in build identity. Configuration is evaluated again before publication;
a changed result fails the build. Imported configuration code is not independently
recorded as a toolchain lock: retain its source commit and dependency locks.

## Choose groups and stable IDs

Group by meaning and ownership: creatures, items, UI and sounds. Give a complex
creature its own directory with a clear entry and explicit imported modules.
Keep small related sprites together. Extract a shared module when assets actually
share a contract, not merely because their files look similar.

Folders organize editing. Package/entry names select compilation. Export IDs are
the adapter contract. In the starter, `items_iron_sword` stays stable even if its
source moves. Sprite entry names must match the sprite's declared ID. Register
every selected file as an entry or reachable module; importing a module does not
make it a separate export. Avoid duplicate catalogs of the same asset list.

There is no 64-export limit. Split workspaces for independent ownership, delivery
or execution budgets, not arbitrary batches. Every output must stay under its
workspace root. Put the workspace at the repository root to use root `build/`;
`../../build` from a nested workspace is invalid. Separate concurrent builds must
own disjoint output directories. Current source/worker budgets still apply; see
[workspace configuration](workspace.md) and [CLI limits](cli.md#execution-limits).

## Build once, consume one verified identity

```sh
npx --no-install ashfox build .ashfoxworkspace.mjs --json
npx --no-install ashfox verify build/assets/compiler --json
node assets.mjs
```

The first two commands show the underlying CLI. `node assets.mjs` performs both;
a game pipeline should invoke the adapter once rather than repeat all three.
The adapter defaults to the CLI installed at the project root. A Gradle toolchain
can pass its checksum-verified extracted CLI path as the argument instead.

The build returns `bundleHash`, `bundlePath`, `catalogPath` and export directories.
The canonical catalog records asset IDs, kinds, relative filenames, sizes and
hashes. The adapter verifies the selected build and checks that its hash matches
the build response. It then resolves files inside that exact immutable bundle.

```js
import { buildAssets } from './assets.mjs';
const built = buildAssets();
const asset = built.catalog.assets.find(item => item.id === 'items_iron_sword');
if (!asset) throw new Error('Missing required sword');
const png = asset.files.find(file => file.path.endsWith('.png'));
if (!png) throw new Error('Missing sword PNG');
const relative = png.path.slice(`assets/${asset.id}/`.length);
const source = built.file(asset.id, relative);
// Pass source to the game's resource copy/import step.
```

Do not derive filenames from the source basename or scan for the newest file.
Do not re-read `current.json` for each asset during a game build. Retain one
verified bundle identity throughout the consumer operation. Missing IDs or files
must fail integration. A failed asset build must stop the game build, even if
an older bundle remains on disk.

Output paths have a stable pattern, but the bundle hash changes when relevant
inputs or execution profiles change. Equal accepted input with the same pinned
compiler, Node/V8, OS/architecture and encoder profile reproduces the bundle hash;
byte equality across arbitrary machines is not promised.

## Adapt to a game engine

Keep engine mapping in one adapter, separate from authored geometry or pixels.
For Gradle, run the asset adapter as an input-producing task and make resource
processing depend on it. Declare source/configuration/toolchain inputs and owned
output directories. Copy only the successful selected delivery into the game's
resource staging area. Never place generated resources back under `asset/`.

For a web game, consume the game-assets manifest through a runtime adapter. For
Java, Kotlin or TypeScript, a project adapter may generate constants or typed
references under `build/generated/assets/`. Language binding generation and
engine-specific build plugins are not built-in CLI features. Likewise, the
workspace does not provide arbitrary post-build hooks: it describes compilation
and delivery; `assets.mjs` owns consumer integration.

Keep publication separate from compilation. An engine adapter may transform
formats where required, but such transformations must have versioned code and
validation. Fix a general exporter defect in Ashfox rather than accumulating
unexplained per-creature output patches.

## Review, clean and upgrade

Put captures and motion previews under `build/review/<asset-id>/`, associated with
the source commit and bundle hash. Review visual/audio changes alongside the Git
diff. Compilation alone does not establish appearance or game compatibility.

Clean only directories owned by your build. Removing root `build/` is appropriate
when the entire repository reserves it for generated data and no builds are
running. Do not delete tracked assets, arbitrary neighboring folders or outputs
being consumed by another process. Clean/rebuild should reproduce the same hash
with the same profile; retained releases belong in artifact storage.

Upgrade the CLI in a dedicated change: update the exact package lock or archive
checksum, rebuild from a clean output tree, verify catalogs and compare game
results. Never replace a published version's bytes to perform an upgrade. Record
source commit, toolchain identity and bundle hash for each delivery so rollback
can select a retained package or rebuild with the original environment.
