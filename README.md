# Ashfox

Create Minecraft-style models, textures, and animation with your AI agent.
Describe what you want, refine it in the browser, and export it for your game.

<p align="center">
  <a href="https://ashfox.io/#examples"><img src="assets/showcase/shared-creatures/griffin-poster.png" alt="Griffin guardian" width="360"></a>
  <a href="https://ashfox.io/#examples"><img src="assets/showcase/shared-creatures/fox-poster.png" alt="Red fox" width="360"></a>
  <a href="https://ashfox.io/#examples"><img src="assets/showcase/shared-creatures/goblin-poster.png" alt="Goblin raider" width="360"></a>
</p>

<details>
<summary>See the build replays</summary>

<p align="center">
  <img src="assets/showcase/shared-creatures/griffin-build-replay.gif" alt="Griffin guardian model build replay" width="360">
  <img src="assets/showcase/shared-creatures/fox-build-replay.gif" alt="Red fox model build replay" width="360">
  <img src="assets/showcase/shared-creatures/goblin-build-replay.gif" alt="Goblin raider model build replay" width="360">
  <br>
  <sub>Build replays reconstructed from the finished models.</sub>
</p>
</details>

[View examples](https://ashfox.io/#examples) ·
[Launch Workbench](https://ashfox.io/workbench/) ·
[Shared workspace](examples/shared-creatures.ashfoxworkspace)

| Character | Keep creating | Use in your game |
| --- | --- | --- |
| Griffin guardian · 6 motions | [Workspace](examples/griffin.ashfoxworkspace) | [GLB](assets/exports/griffin/griffin.glb) |
| Red fox · 3 motions | [Workspace](examples/fox.ashfoxworkspace) | [GLB](assets/exports/fox/fox.glb) |
| Goblin raider · 3 motions | [Workspace](examples/goblin.ashfoxworkspace) | [GLB](assets/exports/goblin/goblin.glb) |

## Get started

Use an AI agent that can control a browser. Paste this instruction followed by
what you want to create or change:

```text
Fetch and follow https://ashfox.io/workbench/agent-manifest.json using a direct HTTP request such as curl.
```

For example: “Create a small griffin guardian with six expressive motions.”

Your agent builds and checks the model in Workbench. Ask for changes in the same
conversation. Download the `.ashfoxworkspace` to keep editing later, or export
Java block, GeckoLib 5, Bedrock, GLB, or glTF files.

[Get started](docs/guides/ai-agent-quick-start.md) ·
[Export formats](docs/guides/choose-a-format.md) ·
[Documentation](docs/README.md)

## Contribute

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and checks, and
[development-manifest.json](development-manifest.json) for repository rules.

[MIT license](LICENSE).
