# Choose a workflow and format

Start with a single command for one asset. Add a workspace when a project needs
shared source selection, IDs and delivery folders. Use a persistent stdio session
when an agent or application needs repeated operations on an asset in memory.

| Task | Single-asset CLI | Stdio session | Workspace build |
| --- | --- | --- | --- |
| Native model, sprite and sound source | Yes | Yes, files or memory graph | Yes, declared sources |
| Existing PNG input | Yes | Yes, file or base64 | No |
| Desired-angle PNG, atlas, waveform | `capture` | `capture` | Separate observation command |
| Animation or turntable GIF | `replay` | `replay` | Separate observation command |
| Source replacement in memory | New stdin input | `load` with expected revision | Source files on disk |
| GLB | Raw binary | Base64 media | Named export |
| glTF | ZIP via `export --format gltf` | ZIP media | Not a workspace export format |
| Java block, GeckoLib 5, Bedrock models | ZIP | ZIP media | Named export directories |
| Sprite PNG / sound WAV | Raw binary | Base64 media | Named exports |
| OGG / complete Java resource pack / game manifest | Use a workspace build | Not a session export | Yes |

See [observation](observe.md), [stdio](stdio.md) and [workspace settings](workspace.md).

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
