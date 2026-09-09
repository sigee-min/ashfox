# CLI reference

After [installation](install.md), use `ashfox` in the consuming project. All examples run the installed local executable with `npx --no-install`.

| Command | Input | Result |
| --- | --- | --- |
| `--help` / `help` | None | Human-readable command guide |
| `--version` | None | Product version |
| `doctor [--json]` | None | Basic exports and optional tool availability |
| `init <new-folder> [--json]` | New folder | Offline starter sources |
| `capabilities --json` | None | Supported commands, output formats and pack settings |
| `check <input> --json` | `.ashfox` entry or `.ashfoxworkspace` | Source hash and compiled product kinds/entries |
| `build <input> --json` | `.ashfox` entry or `.ashfoxworkspace` | Verified bundle, catalog and export directories |
| `verify <directory> --json` | Configured build directory | Selected bundle, receipt and catalog after integrity checks |

`capabilities`, `check`, `build` and `verify` return JSON even without `--json`,
and accept no other flags. `help` is human-readable; use `capabilities` for agents. Their settings belong in source files or `.ashfoxworkspace`.
Single-asset observation commands are documented below and have their own options.
There is no `watch`, `clean` or automatic game-install command.

## First-run commands

<!-- ashfox:availability -->
`--help`, `--version`, `doctor` and `init` are available in development builds.
The published 1.0.0 package uses the starter ZIP workflow in the installation guide.
<!-- ashfox:availability-end -->

```sh
npx --no-install ashfox --version
npx --no-install ashfox doctor
npx --no-install ashfox init assets
npx --no-install ashfox export assets/sword.ashfox --output sword.png
```

Run from the repository where you installed the CLI. `init` creates a new folder
with model, item and sound sources from that compiler's bundled starter. Its
parent must exist. Existing folders (even empty ones), files and symlinks are
refused; no existing project is merged or rewritten. It does not install npm
packages, create `.ashfoxworkspace`, or contact the network. A write failure
removes the new partial folder. `init --json` reports the directory and files.
First-run commands print readable errors to stderr; `doctor` and `init` with
`--json` use the project response envelope on stdout, including failures.

`doctor` reports the CLI/Node versions and whether Chrome can launch and FFmpeg
advertises `libvorbis`. Missing optional tools do not cause a failure exit code.
`doctor --json` reports availability without creating project files. This is an
environment check; use a real capture or OGG build to verify your asset pipeline.
An explicitly configured executable path takes precedence over discovery.


## Build one source

```sh
npx --no-install ashfox build assets/apple.ashfox --json
```

Without an ancestor workspace, the CLI reads the entry and its relative import
closure. It writes `dist/<entry-id>/build` and `dist/<entry-id>/exports` beneath
the entry's directory. It generates no configuration file. Models default to
portable GLB, sprites to PNG, and sounds to WAV. A module is not a build entry.

If an ancestor `.ashfoxworkspace` exists, its entire project is built. Selecting
one entry does not bypass project checks. Discovery stops at the nearest Git
root or filesystem root. Invalid configuration fails instead of falling back.

## Build a project

```sh
npx --no-install ashfox check game-assets/.ashfoxworkspace --json
npx --no-install ashfox build game-assets/.ashfoxworkspace --json
npx --no-install ashfox verify game-assets/dist/build --json
```

Use the actual `build.directory`, not an export directory, for `verify`.
All declared entries and reachable modules must compile, even if not exported.
`check` does not invoke FFmpeg or certify target delivery; run `build` to check
export constraints, file collisions and encoding.

## Read the response

Each project-command response has `format: ashfox-cli-result`, `version: 1`, `command`, `ok`,
`diagnostics` and `result`. On failure, `result` is `null`; read each diagnostic's
`code` and `message`. Do not treat a partial or empty stdout file as success.

A successful build result supplies `requestKey`, `bundleHash`, `bundlePath`,
`catalogPath` and `exports: [{id, directory}]`. Paths are actual absolute paths
for this machine. The catalog's file paths are relative to `bundlePath`.

| Exit code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Source/compiler or declared build validation failure |
| 2 | Invalid arguments or configuration |
| 3 | I/O, encoder, internal, target-export or integrity failure |
| 4 | Another writer owns an output lock |
| 130 | Cancelled |

Use nonzero as failure; inspect diagnostics for the specific remedy. See
[Troubleshooting](troubleshooting.md) rather than retrying blindly.

## Execution limits

Compilation runs in a worker with a 120-second limit and a 256 MiB V8 heap limit.
This is not a total process-memory limit. Sources are bounded to 512 files and
8 MiB; filesystem discovery is bounded to 20,000 entries. Configuration is limited
to 256 KiB. Each pack allows at most 8,192 files and 64 MiB before archiving.
Each FFmpeg operation is limited to 15 seconds and 16 MiB captured output.

SIGINT or SIGTERM cancels ongoing work and preserves the previous selected build.
A final synchronous publication can already have completed when cancellation
arrives. The CLI never rolls back a completed successful publication.

## Single-asset commands

`inspect`, `capture`, `replay`, `export` and `stdio` operate independently of
workspace builds. They use stdout for JSON or media; errors use stderr and file
saving is explicit. Their options and transport differ from the project commands
above. See [Inspect and capture one asset](observe.md) for all flags, memory input,
headless renderer setup and persistent session examples.

| Command | Output | Error channel |
| --- | --- | --- |
| `inspect` | Inspection JSON | stderr JSON |
| `capture` | PNG bytes | stderr JSON |
| `replay` | GIF bytes | stderr JSON |
| `export` | PNG/WAV/GLB bytes or ZIP | stderr JSON |
| `stdio` | JSON-lines responses with matching request IDs | Request failures in response; fatal transport errors on stderr |

These commands do not use the project response envelope or accept `--json`.
See [observation options](observe.md) and [session protocol](stdio.md).
