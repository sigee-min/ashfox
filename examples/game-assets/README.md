# Generic voxel-game asset bundle

Build an animated griffin, an item sprite and sound variants into
one engine-neutral folder and ZIP:

```sh
npx --no-install ashfox build .ashfoxworkspace --json
npx --no-install ashfox verify dist/build --json
```

No FFmpeg is needed with the example's `audio: wav`. Set `audio: ogg` and provide
FFmpeg on PATH or through `ASHFOX_FFMPEG_PATH` for OGG output.

Find the returned export named `voxel_game`. Its directory contains
`game-assets/assets.json`, GLB/PNG/audio files, and `voxel_game.zip`. Use IDs such as
`creature.griffin`, `item.iron_sword`, and `sfx.claw_hit` to find the
runtime files and metadata. Paths are relative to `assets.json`.

The workspace controls placement, IDs, archive creation, audio codec and import
hints. Models default to portable GLB without required compression extensions.
The engine's native importer is responsible for loading assets and applying unit
and sprite hints. No engine-specific scene or prefab is generated.

See the [configuration and runtime contract](../../docs/guides/game-assets.md).
