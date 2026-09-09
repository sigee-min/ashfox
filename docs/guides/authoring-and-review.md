# Review and refine assets

Edit the `.ashfox` source, rebuild, then inspect the generated result. An agent
can do the edits and commands, but passing compilation does not prove that the
asset looks or sounds right in the game.

## Give useful direction

Specify the subject, silhouette, palette, size and motion or sound behavior.
When changing an existing asset, name what to preserve. For example:

```text
Make the griffin's head wider while keeping the current expression and eye marks.
Preserve all clip names. Rebuild the game bundle and report which files changed.
```

Give the agent the actual source folder and intended output ID. Use
[Agent workflow](agent-workflow.md) for a command-based working sequence.

## Review each kind

| Asset | Check |
| --- | --- |
| Model | Silhouette, scale, face direction, material, texture seams, attachment points |
| Animation | Every clip, opening/closing poses, extremes, attachments and gameplay timing |
| Sprite | Transparency, readability at 16×16, contrast, edges, filtering in-game |
| Sound | Every variant, attack/release, clipping, loudness relative to other effects |
| Bundle | Expected IDs, paths, selected variants and receiving-engine import settings |

Use [CLI observation](observe.md) for model views, motion GIFs, native/enlarged
sprites and sound waveforms. Export WAV for listening. A capture identifies an
observation; a game export contains the asset itself.

## Iterate safely

For one asset, edit source, `inspect`, then `capture` or `replay` and export it.
For a configured delivery, run `check`, `build` and `verify`, and inspect the
newly returned output directory. Do not accidentally review a previous bundle.
Keep source changes in Git so you can compare and revert deliberately.

When a model looks wrong only after import, inspect the importer's axis/scale and
material settings before changing the source. When a sprite is blurry, inspect
filtering. When a sound is silent, inspect the runtime event/variant path and
playback settings. See [Troubleshooting](troubleshooting.md).
