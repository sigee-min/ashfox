# Troubleshooting

Project commands return `diagnostics[].code` and `message` in their JSON response.
Single-asset commands report JSON errors on stderr; stdio sessions return an
`ok: false` reply with `error.code` and `error.message`. A nonzero exit
code means the new build must not be consumed as successful. Failed publication
preserves the previous selected build.

| Symptom / code | What to do |
| --- | --- |
| `cli.arguments` | For project commands (`check`, `build`, `verify`, `capabilities`), only `--json` is a flag. For observation options, see [capture](observe.md). |
| `workspace.config` | Fix the reported field. The root is an exact version-2 configuration with required package/build/export fields and optional `packs`. Unknown fields fail. |
| Unexpected assets build | For `check` and `build`, a parent `.ashfoxworkspace` selects the whole project. Standalone observation/export commands always select their explicit input. Pass that file explicitly or move a standalone entry outside its scope. |
| Missing/undeclared source or module | Register every selected source and reachable module; fix include/ignore rules and relative imports. |
| `source.import` / `source.cycle` | Fix explicit module paths and cycles. Standalone imports cannot escape the entry directory. |
| `source.symlink` / `source.path` | Use regular files and normalized relative paths. Symlinks and traversal are rejected. |
| `source.changed` | Source changed during compilation. Finish edits and start a fresh build. |
| `pack.source` / unknown sound variant | Reference an existing compatible export and an actual variant ID. Read the source's `variants`. |
| `pack.collision` | Two bindings emit the same file, or a file conflicts with a directory. Give them distinct IDs/paths or remove the duplicate. |
| `audio.encoder` | Install FFmpeg with libvorbis or correct `ASHFOX_FFMPEG_PATH`; it must point to an executable, not a directory. |
| `audio.clipping` | Lower the sound source's peak ceiling and rebuild. OGG can overshoot a WAV peak. |
| `audio.timeout` / `build.timeout` | Reduce the job or investigate a hung encoder. Do not extend a timeout by editing generated receipts. |
| Writer conflict / exit 4 | Wait for the other writer; use disjoint destinations for independent jobs. |
| Unowned destination | Choose a new/empty output directory. The CLI does not overwrite unrelated existing contents. |
| `output.integrity` | A generated file is missing, changed or extra. Rebuild into a fresh owned destination; never edit hashes to hide corruption. |
| Output looks old | Read the returned immutable directory or `current.json`, not the newest folder by timestamp. |

## A model target rejects the asset

`check` validates source, but `build` also validates the receiving format.
Java block rejects animation. Actor targets require their production idle clip.
General GLB scene assets can be static. Read the target message; do not assume
unsupported features will be removed automatically. [Choose output](choose-a-format.md).

## Import looks or sounds wrong

- **GLB won't load:** use portable encoding, or supply importer support for every
  `requiredExtensions` value in the game manifest.
- **Wrong model size:** check source dimensions and the importer's unit conversion.
  Apply `unitsPerMeter` once; it is a hint, not an already-baked extra scale.
- **Blurry sprite:** apply its filter and pixels-per-unit settings in the engine.
- **Missing Minecraft image:** check namespace, item ID, selected item-definition
  shape and pack-format metadata. Metadata alone does not register a new item.
- **Missing sound:** confirm the actual OGG/WAV path and variant/event mapping.
  Generated sound definitions do not attach themselves to game actions.

## Recover after a crashed writer

Inspect each affected output's `.writer/owner.json`. Confirm its recorded process
is no longer running before removing that abandoned `.writer` directory. Do not
remove a live writer's lock. Then rerun `build`; it will verify any existing
immutable result before using it. If unsure, choose new output directories.

## Report a reproducible issue

Include the CLI command, diagnostic JSON, compiler/Node versions, relevant source
and configuration, and FFmpeg version if OGG is involved. Include the intended
engine/importer and the exact failing asset ID. Keep credentials and unrelated
project files out of the report.

For capture failures, check `ASHFOX_CHROME_PATH`, unknown clip/node/variant IDs,
and the media budget in the [observation guide](observe.md). Capture errors use
stderr, leaving stdout free of error text. A failed or cancelled session load
keeps the previous revision; read `source` and retry with its `expectedRevision`.
