# Engine-neutral game assets

Minecraft resource packs are one delivery target. General voxel and low-poly
games use `packs[].format: game_assets`, which emits GLB models, PNG sprites,
WAV or OGG sound variants, and an engine-neutral `assets.json` runtime manifest.
A game addresses assets by configured IDs instead of guessing build paths.

The same `.ashfox` sources and named `exports` can feed several game packs and
Minecraft packs in one atomic build. This does not introduce another source
language or couple the source compiler to a particular game engine.

## Configuration

Download [the complete game project](/downloads/game-assets.zip) and extract it, or inspect
`showcase/.ashfoxworkspace` for a complete multi-domain showcase configuration.
Its pack declaration is:

```json
{
  "name": "voxel_game",
  "format": "game_assets",
  "directory": "dist/game",
  "archive": true,
  "audio": "wav",
  "unitsPerMeter": 1,
  "pixelsPerUnit": 16,
  "spriteFilter": "nearest",
  "assets": [
    { "id": "creature.griffin", "source": "griffin", "path": "models/griffin" },
    { "id": "item.iron_sword", "source": "iron_sword", "path": "sprites/items" },
    { "id": "sfx.claw_hit", "source": "claw_hit", "path": "audio/claw_hit" }
  ]
}
```

All fields shown are required. `source` is an export name; `id` is the runtime
asset ID; `path` is a relative directory inside the package. IDs must be unique
within the package. File/directory conflicts and duplicate emitted paths fail,
even when the bytes match. Paths cannot escape the package or occupy the reserved
`assets.json` path. Bindings accept only `glb`, `png`, and `wav` source exports.
Minecraft-specific file trees are not interpreted as generic models.

`audio: wav` needs no external encoder. `audio: ogg` converts bound sounds through
the built-in WebAssembly OGG Vorbis encoder with no external tools required. A pack with no sounds
never invokes audio encoding. The original WAV exports remain available separately.
The package always emits a folder; `archive: true` adds a stable ZIP containing
exactly that folder's files, with `assets.json` at the archive root.

## GLB portability and import settings

CLI GLB exports default to `encoding: portable`. This stores standard float
vertex attributes and skips Meshopt compression, requiring no compression or
mesh-quantization extensions. Embedded textures, meshes, materials, skins and
animation clips remain in one GLB. Static scene assets need no idle animation;
geometry, texture coverage and any authored animation are still validated.
Actor-specific Minecraft targets retain their idle requirement.

A project can explicitly opt into the smaller existing encoding:

```json
{
  "name": "griffin",
  "entry": { "packageName": "workbench", "entryName": "griffin" },
  "format": "glb",
  "encoding": "optimized",
  "directory": "dist/models"
}
```

The runtime manifest records the GLB's actual `requiredExtensions`; an optimized
asset may need Meshopt and mesh-quantization support in the receiving importer.
Use portable output unless you have checked your importer's extension support.

GLB geometry follows the existing glTF exporter: one source `u` is encoded as
1/16 meter. The model's `coordinateSystem: gltf2` describes the encoded basis.
Let the receiving engine's GLB importer handle its axis/handedness conversion.
`unitsPerMeter` is an import hint for the game, not an extra baked transform; apply
it once if your importer does not already handle that conversion.
For example, use 1 for one engine unit per meter or 100 for centimeter-based units.

Sprite metadata carries pixel dimensions, `pixelsPerUnit`, and `filter`.
At 16 pixels per unit, a 16-pixel sprite is one game unit wide. `nearest` preserves
hard pixel edges; `linear` requests interpolation. These settings are hints for
the sprite/texture importer. They do not rewrite GLB material samplers or silently
configure an engine project.

## Runtime manifest

The returned pack destination contains:

```text
game-assets/
  assets.json
  models/griffin/griffin.glb
  sprites/items/iron_sword.png
  audio/claw_hit/<variant>.wav
voxel_game.zip
```

`assets.json` has `format: ashfox-game-assets`, `version: 1`, and `assets` ordered
by ID. Every file path is relative to the folder containing that manifest.
When a pack bundles two or more GLB assets, identical embedded PNG textures are
deduplicated by SHA-256 content hash into `textures/<hash12>.png` (recorded in
`sharedTextures` in `assets.json`), and each GLB references the shared PNG via
relative URI with orphaned image bytes stripped from its binary chunk. Single-GLB
packs keep textures embedded inside the GLB for standalone drop-in use.
There are no absolute paths, compiler receipts or Minecraft registration files
inside the game folder. Build receipts remain in the canonical build bundle.

| Asset kind | Runtime fields |
| --- | --- |
| `model` | `model` file path, glTF coordinate convention, `unitsPerMeter`, required extensions, clip names and durations, and fitted physics `colliders` (`capsule` / `box` + root `aabb`) |
| `structure` | `model` file path, `meta` (`.structure.json`), `unitsPerBlock`, required extensions, `size`, zone/light/interactable counts |
| `sprite` | `image` file path, width, height, pixels per unit and filter |
| `sound` | codec and named variants with file paths, intended durations, `sampleRate`, `channels`, `playback`, and gapless OGG loop bounds (`loopStartSample`, `loopEndSample`) |

## Runtime budgets and LOD tiers

Exported GLB assets target strict runtime budgets across draw calls, triangles,
file size, and 3-tier LOD (`*_LOD0`, `*_LOD1`, `*_LOD2` with `MSFT_lod`):

| Asset tier | Draw calls | Triangles (LOD0) | GLB size | LOD1 triangle ratio | LOD2 draw calls |
| --- | --- | --- | --- | --- | --- |
| `creature` / `prop` | `<= 4` (`<= 2` skinned) | `<= 1,500` | `<= 64 KB` | `<= 55%` | `1` |
| `structure` | `<= 18` | `<= 18,000` | `<= 350 KB` | `<= 25%` | `1` |
| `compound` | `<= 28` | `<= 45,000` | `<= 1.1 MB` | `<= 25%` | `1` |

Every entry also has `id` and `files` with exact byte lengths and SHA-256 hashes.
For OGG, duration is the source's intended duration; decoding may add or remove a
small encoder-padding interval, checked by the encoding adapter.

A web game can resolve the file to hand to its own GLB loader as follows:

```js
const manifestUrl = new URL('./game-assets/assets.json', document.baseURI);
const response = await fetch(manifestUrl);
if (!response.ok) throw new Error(`Asset manifest: HTTP ${response.status}`);
const manifest = await response.json();
if (manifest.format !== 'ashfox-game-assets' || manifest.version !== 1) {
  throw new Error('Unsupported asset manifest');
}
const griffin = manifest.assets.find(asset => asset.id === 'creature.griffin');
if (!griffin || griffin.kind !== 'model') throw new Error('Missing griffin model');
const glbUrl = new URL(griffin.model, manifestUrl);
// Pass glbUrl to your engine's GLB importer; use griffin.clips for animation names.
```

For a complete loader that displays models, plays animation, shows an item and
plays sound, follow [the web-game example](web-game.md).

## Verification and boundaries

```sh
npx --no-install ashfox build .ashfoxworkspace --json
npx --no-install ashfox check dist/build
```

Use the returned pack directory, or unpack its ZIP into your game’s asset
folder. Read `assets.json`, resolve IDs, and configure your importer using the
metadata above. Verify the canonical build before copying; keep the selected
bundle fixed for the entire game build. See [automation](automation.md).

The package contains render/audio assets and import metadata. It does not generate
voxel chunk storage, terrain meshing, collision bodies, gameplay definitions,
engine prefabs/scenes, or an engine-specific runtime loader. A receiving engine
still needs its supported GLB/PNG/audio import path. Rendering in a particular
engine has not been certified by the format tests.
