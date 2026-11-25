# Choose a workflow and format

Start with a single command for one asset. Add a workspace when a project needs
shared source selection, IDs and delivery folders. Pass `--stdin` or `--input-json`
when driving `check`, `render`, or `export` from memory.

| Task | Single-asset CLI | Workspace build |
| --- | --- | --- |
| Native model, sprite and sound source | Yes (`check`, `render`, `export`) | Yes, declared sources |
| Existing PNG input | Yes (`check`, `render`, `export`) | No |
| Inspect structure & audit scores | `check` | `check <workspace>` / `build` |
| Desired-angle PNG, atlas, waveform | `render` | Separate single-asset `render` |
| Animation or turntable GIF | `render --gif` | Separate single-asset `render --gif` |
| Source replacement in memory | `--stdin` / `--input-json` | Source files on disk |
| GLB | Raw binary (`export`) | Named export |
| glTF | ZIP via `export --format gltf` | Not a workspace export format |
| Java block, GeckoLib 5, Bedrock models | ZIP (`export`) | Named export directories |
| Sprite PNG / sound WAV | Raw binary (`export`) | Named exports |
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
