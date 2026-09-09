# Build a Minecraft Java resource pack

`.ashfoxworkspace` describes the project's build, including delivery. Native
`.ashfox` files own asset content. `exports` selects an entry and compiler output;
optional `packs` binds those named outputs to game resources and archives.
The sibling `game_assets` target emits [engine-neutral bundles](game-assets.md);
a workspace may declare both targets.
Changing a resource ID, event, namespace, folder, or pack format is a configuration
edit, not a compiler edit. One export may feed several packs with different IDs.

Omit `packs` when you only need individual exports. A supplied `packs` list and all
nested records are closed: unknown fields, missing required fields, invalid
references, duplicate IDs and unsafe paths fail. There is no embedded shell code,
network lookup, automatic version selection, or authoring of generated files.

## Configuration

Download and extract [the complete resource-pack project](/downloads/resource-pack.zip).
Its configuration is
[`examples/resource-pack/.ashfoxworkspace`](../../examples/resource-pack/.ashfoxworkspace).
It declares the sources and exports, then uses this pack declaration:

```json
{
  "name": "game_pack",
  "format": "minecraft_java",
  "directory": "dist/pack",
  "minecraftVersion": "26.2",
  "metadata": {
    "format": "range",
    "minFormat": [88, 0],
    "maxFormat": [88, 0],
    "description": "Code-authored game assets"
  },
  "itemDefinitions": "modern",
  "archive": true,
  "icon": "iron_sword",
  "models": ["marker"],
  "items": [
    { "source": "iron_sword", "id": "minecraft:iron_sword", "parent": "handheld" }
  ],
  "sounds": [
    {
      "source": "claw_hit",
      "id": "demo:combat.claw_hit",
      "replace": true,
      "subtitle": null,
      "volume": 1,
      "pitch": 1,
      "stream": false,
      "variants": "all"
    }
  ]
}
```

`source`, `icon`, and `models` refer to `exports[].name`, not filesystem paths.
Every pack field shown above is required. Empty lists are allowed; `icon: null`
omits the icon. Root `packs` is optional. Export names and pack names share one
unique ID namespace. Build, export, and pack output directories must be disjoint,
project-relative, and outside source paths and reserved directories.

| Setting | Meaning |
| --- | --- |
| `minecraftVersion` | Informational project label recorded in the catalog; never controls hidden branching |
| `metadata.format: range` | Emit `min_format` and `max_format` from explicit `[major, minor]` tuples |
| `metadata.format: legacy` | Use `packFormat` instead of the two range fields; emit `pack_format` |
| `itemDefinitions: modern` | Emit both `items/<id>.json` and `models/item/<id>.json` |
| `itemDefinitions: legacy` | Emit the item model without the newer `items/` entry point |
| `archive` | Also produce a ZIP with `pack.mcmeta` at the archive root |
| `icon` | Named PNG export to use as `pack.png` |
| `models` | Named `java_block` or `geckolib5` exports to merge at their existing resource paths |
| `items[].id` | Resource ID, including namespace; determines the item definition, model and texture paths |
| `items[].parent` | `generated` or `handheld`, selecting the vanilla item-model parent |
| `sounds[].id` | Sound-event resource ID; determines the namespace's `sounds.json` entry |
| `sounds[].variants` | `all`, or a nonempty list such as `[{"id":"base","weight":3}]` |
| `sounds[].replace` | Whether the event replaces lower-pack sound definitions |
| `sounds[].subtitle` | Existing localization key, or `null`; translations are not inferred |
| `sounds[].volume`, `pitch`, `stream` | Playback settings written to each selected sound object |

Volume must be greater than 0 and at most 1, pitch greater than 0 and at most 2.
Weights are positive integers. All source variants still compile; selection
controls which ones are delivered in the pack. FFmpeg's Vorbis encoder currently
uses a fixed quality-5 profile, PCM input is the source compiler's 48 kHz mono WAV.

The example's format 88.0 comes from the
[26.2 release notes](https://www.minecraft.net/en-us/article/minecraft-java-edition-26-2).
The modern metadata fields follow the
[1.21.9 format change](https://www.minecraft.net/en-us/article/minecraft-java-edition-1-21-9).
The newer item entry point follows the
[client-item contract](https://docs.neoforged.net/docs/1.21.4/resources/client/models/items/),
and sound-event mappings follow the
[sound definitions contract](https://docs.neoforged.net/docs/1.21.8/resources/client/sounds/).
These are example values and explicit schema choices, not a latest-version alias.
Changing metadata does not convert geometry, animation, or game registration to
another engine version. Individual model exporters retain their existing
compatibility profiles. Declaring a broad pack-format range does not certify it.

## Execution and output

```sh
npx --no-install ashfox check .ashfoxworkspace --json
npx --no-install ashfox build .ashfoxworkspace --json
npx --no-install ashfox verify dist/build --json
```

Sound packs require FFmpeg with `libvorbis`. Use `ffmpeg` on PATH, or set
`ASHFOX_FFMPEG_PATH` to its executable path. No dependency download happens during
build. Sprite/model-only packs and individual WAV exports require no encoder.
`check` validates the source graph and declarations without running FFmpeg;
`build` also validates exported files, merges, encoding and publication.

The returned `exports` contains the named pack destination. Inside that immutable
directory are:

```text
resource-pack/
  pack.mcmeta
  pack.png
  assets/minecraft/items/iron_sword.json
  assets/minecraft/models/item/iron_sword.json
  assets/minecraft/textures/item/iron_sword.png
  assets/minecraft/models/block/stone.json
  assets/minecraft/blockstates/stone.json
  assets/minecraft/textures/block/stone.png
  assets/demo/sounds.json
  assets/demo/sounds/combat.claw_hit/<variant>.ogg
game_pack.zip
```

The folder is always emitted; the ZIP is optional. ZIP entries have stable order
and timestamps and use storage mode. The ZIP contains exactly the resource-pack
files, with no extra wrapper folder, receipts or WAV originals. Catalog entries
of `kind: pack` identify `resourceRoot`, optional archive name and project version.
Original PNG/WAV/model exports remain available as ordinary catalog entries.

Pack metadata is emitted once from `packs[].metadata`; individual block exporters'
`pack.mcmeta` files are omitted while merging. All other duplicate paths fail,
even if their bytes match. Namespaces have one merged `sounds.json` per pack.
Every selected sound file is encoded, independently decoded, checked for duration
and clipping, and referenced by its actual emitted path.

A failed build preserves the previous complete output. `verify` checks the
canonical bundle; keep the returned build selected throughout your game build.
Pin FFmpeg when byte-identical OGG results are required. Packs are limited to
8,192 files / 64 MiB before archiving; see [CLI limits](cli.md).

## Use in Minecraft

Copy the returned `game_pack.zip` into your client’s `resourcepacks` folder and
enable it in Resource Packs. For a folder installation, copy `resource-pack`
with `pack.mcmeta` directly inside it. Test using the exact version configured
for your project. The example changes the iron sword appearance and stone model;
its custom sound event must be triggered by the game or a command.

In a test world with commands enabled:

1. Enable this pack above other packs that replace the same resources. Reload
   resources after replacing an installed pack.
2. Run `/give @s minecraft:iron_sword` and inspect its inventory icon and held view.
3. Run `/give @s minecraft:stone`, place it, and inspect the replacement marker model.
4. Run `/playsound demo:combat.claw_hit master @s ~ ~ ~ 1 1` near the player.
   Repeat to hear the selected variants. Ensure the master volume is audible.
5. Disable the pack and compare the sword and stone with their original appearance.

If the event is missing, check `assets/demo/sounds.json` and its referenced OGG
paths inside the ZIP. If the pack is rejected, compare `pack.mcmeta` with the
client version and edit the workspace metadata before rebuilding. These are
manual acceptance checks; successful CLI verification does not run Minecraft.

Ashfox builds Java resource packs. It does not generate Bedrock addon
manifests, register new blocks/entities, build mod JARs, localize subtitle keys,
install into a game directory, or validate rendering in a running client. An
item resource ID can replace an existing item's appearance or be selected by the
game's item-model component; it is not by itself a new registered item. Sound
definitions do not automatically bind events to combat or animation timelines.
