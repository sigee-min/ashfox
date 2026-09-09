# Create and use game assets

Write low-poly models, pixel items and sound effects as `.ashfox` source. Inspect
one asset, capture it from your chosen view and export it to your game. Files
and in-memory workflows are both supported; stdio is the default output path.

## Start here

[Install Ashfox](guides/install.md), then follow
[your first asset](guides/ai-agent-quick-start.md). The downloadable starter
contains complete model, item and sound sources; no workspace setup is needed.

## Choose what to do

| Your task | Guide |
| --- | --- |
| Choose an angle, inspect PNG pixels or watch animation | [Observe an asset](guides/observe.md) |
| Create a prop or creature | [Models](guides/models.md) |
| Draw and shade an item | [Sprites](guides/sprites.md) |
| Synthesize and listen to effects | [Sounds](guides/sounds.md) |
| Refine the result with an agent | [Review and refine](guides/authoring-and-review.md) |
| Pass source, images and requests in memory | [Stdio and memory](guides/stdio.md) |
| Choose a format or execution mode | [Support matrix](guides/choose-a-format.md) |
| See models, items and sound working together | [Playable web example](guides/web-game.md) |
| Deliver to Minecraft Java | [Minecraft resource packs](guides/minecraft-packs.md) |
| Organize multiple sources and delivery paths | [Project settings](guides/workspace.md) |
| Consume IDs, scale and import metadata | [Game bundles](guides/game-assets.md) |
| Save, reproduce or automate a delivery | [Save and deliver](guides/save-and-export.md), [CI](guides/automation.md) |
| Resolve a failure | [Troubleshooting](guides/troubleshooting.md) |

## Keep the editable source

`.ashfox` files and their imported modules are your editable assets. An optional
`.ashfoxworkspace` configures multi-asset builds and delivery. PNG, GLB, audio and
ZIP are generated results; changing them does not update the source.

The optional browser [Model Workbench](guides/workbench-api.md) has its own model
project storage. It does not open native directory configurations. Compare the
available workflows in the [support matrix](guides/choose-a-format.md).
