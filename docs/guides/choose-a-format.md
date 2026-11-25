# Choose a workflow and format

Start with a single command for one asset. Add a workspace when a project needs
shared source selection, IDs and delivery folders. Pass `--stdin` or `--input-json`
when driving `check` or `render` from memory.

| Task | Single-asset CLI | Workspace build |
| --- | --- | --- |
| Native model, sprite, sound, structure source | Yes (`check`, `render`, `build`) | Yes, declared sources |
| Inspect structure & audit scores | `check` | `check <workspace>` / `build` |
| Desired-angle PNG, atlas, cutaway, waveform | `render --view <name>` | Separate single-asset `render` |
| Animation, turntable, or build replay GIF | `render --view <name>` (`kind = gif;` in preview) | Separate single-asset `render --view <name>` |
| Source replacement in memory | `--stdin` / `--input-json` | Source files on disk |
| GLB / glTF / Minecraft targets / NBT / PNG / WAV | `outputs { ... }` + `build` | Named `exports` + `build` |
| OGG / complete Java resource pack / game manifest | Use a workspace build | Yes |

See [render and check](observe.md) and [workspace settings](workspace.md).

## Choose the receiving format

| Destination | Use | What you still supply |
| --- | --- | --- |
| General game or viewer | Portable GLB; PNG; WAV/OGG | Importer, game scene and behavior |
| Several assets with runtime IDs | `game_assets` pack | Read `assets.json` and load the referenced files |
| Minecraft Java visual/audio replacement | `minecraft_java` resource pack | Compatible pack settings; game-side event triggers |
| Minecraft static block | `java_block` | Existing block ID or mod registration |
| GeckoLib entity | `geckolib5` | Mod and entity registration |
| Bedrock entity | `bedrock` | Addon manifest, behavior and registration |

Portable GLB embeds textures and animations without required compression
extensions. Workspace GLB can opt into `optimized`; check importer support for
its `requiredExtensions` first. Static general models need no idle clip.
Java block rejects animation. GeckoLib and Bedrock actor exports require idle.
Target-incompatible content fails export rather than being silently dropped.

For working examples, use [the web game](web-game.md),
[general bundles](game-assets.md), or [Minecraft packs](minecraft-packs.md).
