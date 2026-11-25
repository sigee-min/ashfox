# Work with an asset agent

Give the agent access to the native source folder and CLI. It can author models,
sprites and sounds, configure delivery, run the build, and report exact outputs.
A browser connection is not required for the file-based pipeline.

## Task prompt

```text
Read the selected .ashfox source and imported modules. Preserve unrelated assets.
For a single asset, check it, edit source, render useful views and animated GIFs,
and export only requested files. For a configured game delivery, run check, build,
and bundle check against the workspace and build folder. Report the observed result
and what remains to be checked in the receiving game.
```

Add the subject, dimensions, palette, motion/sound intent, and destination.

## Working sequence

1. Choose the [execution mode](choose-a-format.md): one asset, stdin/JSON memory graph,
   or configured workspace build.
2. Run `ashfox check` to inspect identifiers and quality audit metrics. Single-asset
   flags (`--node`, `--profile`, `--threshold`, `--stdin`, `--input-json`) ignore
   ancestor workspace files; workspace checks validate project rules.
3. Edit `.ashfox` source files (or pipe full source graphs via `--input-json`).
4. Run `ashfox render` for key views/atlases, `ashfox render --gif` for changed
   motions, and listen to exported WAV variants.
5. Export the selected asset (`ashfox export`), or `check` + `build` + `check <build-dir>`
   for a configured delivery.
6. Return media or output locations and distinguish observed results from
   receiving-game behavior that has not been checked.

## Delivery choices

Use [Project configuration](workspace.md) for source selection and output rules.
Use [Game assets](game-assets.md) for runtime IDs and import hints or
[Minecraft packs](minecraft-packs.md) for item and sound-event mappings. Choose
explicit format settings; do not infer compatibility from a version label.

Edit source files directly. Project `build` publishes complete output after validation.

## Observe while editing

Use [single-asset render and check](observe.md) after edits: inspect IDs and
quality scores with `ashfox check`, render key angles and textures with
`ashfox render`, and animate changed clips with `ashfox render --gif`.
Single-asset commands work directly from files or stdin/JSON without workspace publication.
