# Ashfox CLI

Create low-poly models, pixel items and procedural sound effects as `.ashfox`
source. Inspect one asset, capture it from a chosen angle, and export files or
pass bytes directly to your game pipeline. Node.js 20 or newer is required.

## Install and start

Install the latest published CLI using the [installation guide](https://ashfox.io/docs/guides/install/).
This package includes an offline starter matching its compiler:

```sh
npx --no-install ashfox --version
npx --no-install ashfox doctor
npx --no-install ashfox init assets
npx --no-install ashfox export assets/sword.ashfox --output sword.png
```

Run `--help` for a short command guide or `capabilities` for the machine contract.
`init` requires a new folder under an existing parent and never modifies an
existing folder or npm project. No network access is required for initialization.
Missing optional tools in `doctor` do not prevent normal exports.

Capture and GIF replay require Chrome or Chromium. OGG output requires FFmpeg
with `libvorbis`. Ordinary inspection and GLB/PNG/WAV exports require neither.
Use `ASHFOX_CHROME_PATH` and `ASHFOX_FFMPEG_PATH` to select executables when needed.
See [installation and platform notes](https://ashfox.io/docs/guides/install/).

## Work in memory

Omit `--output` to receive binary media on stdout. Errors go to stderr; existing
output files are refused. Use `npx --no-install ashfox stdio` for a persistent
JSON-lines session that loads, edits and captures source in memory. File imports
resolve beneath the input directory; memory inputs supply their complete graph.
See [capture](https://ashfox.io/docs/guides/observe/) and the
[runnable stdio client](https://ashfox.io/docs/guides/stdio/).

## Build a project

An optional `.ashfoxworkspace` configures sources, exports, runtime IDs and packs.
From an installed project folder:

```sh
npx --no-install ashfox check .ashfoxworkspace
npx --no-install ashfox build .ashfoxworkspace
npx --no-install ashfox verify dist/build
```

Use your configured build directory for verification. Project commands return
JSON with diagnostics and exact immutable output paths. Stop on any nonzero exit
code. `check` and `build` discover ancestor configuration; single-asset observation
and export always use their explicit input.

- [Complete game example](https://ashfox.io/docs/guides/web-game/)
- [Project configuration](https://ashfox.io/docs/guides/workspace/)
- [Minecraft packs](https://ashfox.io/docs/guides/minecraft-packs/)
- [Formats and support matrix](https://ashfox.io/docs/guides/choose-a-format/)
- [CLI reference](https://ashfox.io/docs/guides/cli/)
- [Troubleshooting](https://ashfox.io/docs/guides/troubleshooting/)
