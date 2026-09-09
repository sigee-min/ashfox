# Work with an asset agent

Give the agent access to the native source folder and CLI. It can author models,
sprites and sounds, configure delivery, run the build, and report exact outputs.
A browser connection is not required for the file-based pipeline.

## Task prompt

```text
Read the selected .ashfox source and imported modules. Preserve unrelated assets.
For a single asset, inspect it, make the source change, capture useful views and
replay changed motions. Use stdio for in-memory output; save only requested files.
For a configured game delivery, additionally check, build and verify the workspace.
Report the observed result and what remains to be checked in the receiving game.
```

Add the subject, dimensions, palette, motion/sound intent and destination.

## Working sequence

1. Choose the [execution mode](choose-a-format.md): one asset, in-memory session,
   configured build, or an explicitly requested browser Workbench task.
2. Inspect source and identifiers. Single-asset observation ignores ancestor
   workspace files; a project build follows their source-selection rules.
3. Edit source or replace the complete session graph with `expectedRevision`.
4. Inspect, capture relevant angles/pixels and listen to sound variants.
5. Export the selected asset, or check/build/verify a configured delivery.
6. Return media or output locations and distinguish observed results from
   receiving-game behavior that has not been checked.

## Delivery choices

Use [Project configuration](workspace.md) for source selection and output rules.
Use [Game assets](game-assets.md) for runtime IDs and import hints or
[Minecraft packs](minecraft-packs.md) for item and sound-event mappings. Choose
explicit format settings; do not infer compatibility from a version label.

Edit source files directly or use the stdio source-replacement operation.
Project `build` publishes complete output after validation. The separate browser model tool has its own
[Workbench API](workbench-api.md); use that only when the task explicitly works
inside that tool.

## Observe while editing

Use [single-asset capture](observe.md) after edits: inspect IDs, capture relevant
angles and texture details, and replay each changed motion. Read PNG/GIF bytes
from stdout or use a persistent `ashfox stdio` session. In that session, `load`
replaces the complete source graph with an expected revision; failed compilation
preserves the previous asset. Capture does not require workspace publication.
