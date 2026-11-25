# Work with an asset agent

Give the agent access to the native source folder and CLI. It can author models,
sprites and sounds, configure delivery, run the build, and report exact outputs.
A browser connection is not required for the file-based pipeline.

## Task prompt

```text
Read the selected .ashfox source and imported modules. Preserve unrelated assets.
For a single asset, check it, edit source, render declared preview views and animated GIFs,
and build declared outputs. For a configured game delivery, run check, build,
and bundle check against the workspace and build folder. Report the observed result
and what remains to be checked in the receiving game.
```

Add the subject, dimensions, palette, motion/sound intent, and destination.

## Working sequence

1. Choose the [execution mode](choose-a-format.md): one asset, stdin/JSON memory graph,
   or configured workspace build.
2. Run `ashfox check` to inspect identifiers, declared `outputs`/`previews`, and quality audit metrics. Single-asset
   flags (`--stdin`, `--input-json`) ignore
   ancestor workspace files; workspace checks validate project rules and canonical layout.
3. Edit `.ashfox` source files (or pipe full source graphs via `--input-json`), declaring `outputs { ... }` and `preview [name] { ... }` blocks directly in `.ashfox`.
4. Run `ashfox render <source> --view <name>` for key views/atlases and changed
   motions (`kind = gif;` in preview), and listen to built WAV variants from `ashfox build`.
5. Build the selected asset (`ashfox build <source>`), or `check` + `build` + `check <build-dir>`
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

Use [single-asset render and check](observe.md) after edits: inspect IDs, declarations, and
quality scores with `ashfox check`, and render key angles, texture atlases, and motion clips declared via
`preview` blocks with `ashfox render --view <name>`.
Single-asset commands work directly from files or stdin/JSON without workspace publication.
