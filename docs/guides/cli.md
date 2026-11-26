# CLI reference

After [installation](install.md), use `ashfox` in the consuming project. All examples run the installed local executable with `npx --no-install`.

| Command | Input | Result |
| --- | --- | --- |
| `--help` / `help` | None | Human-readable command guide |
| `--version` | None | Product version |
| `init <new-folder> [--json]` | New folder | Offline canonical starter sources (`assets/{models,sprites,sounds,structures,module}/`) |
| `doctor [--json]` | None | Runtime readiness and machine-readable contract |
| `check <input> [options]` | `.ashfox` entry, `.ashfoxworkspace`, `.ashfoxworkspace.mjs`, or build folder | Source validation, inspection, quality audit, or build integrity check |
| `render <input> [options]` | `.ashfox` source (`--stdin` / `--input-json` supported) | PNG still image or animated GIF rendered from declared `preview [name]` blocks |
| `build <input> [--json] [--bindings ts\|cs\|gd]` | `.ashfox` entry, `.ashfoxworkspace`, or `.ashfoxworkspace.mjs` | Compiled outputs declared via `outputs { ... }` or workspace configuration, `<target>.hooks.json`, and optional hook bindings |

`init`, `doctor`, `check`, and `build` return JSON using the `ashfox-cli-result` envelope (`doctor`/`init` take `--json`; `check`/`build` always return JSON).
`help` is human-readable; use `doctor --json` for agents to inspect the complete contract.
`render` writes binary media to stdout (or `--output <file>`) and JSON diagnostics to stderr.
There is no `export`, `watch`, `clean`, or automatic game-install command.

## First-run commands

<!-- ashfox:availability -->
The stable CLI includes help, version, environment checks and offline starter creation.
<!-- ashfox:availability-end -->

```sh
npx --no-install ashfox --version
npx --no-install ashfox doctor
npx --no-install ashfox init assets
npx --no-install ashfox build assets/assets/sprites/sword.ashfox --json
```

Run from the repository where you installed the CLI. `init` creates a new folder
with grouped `assets/{models,sprites,sounds,structures,module}/` sources,
`.ashfoxworkspace.mjs`, the `assets.mjs` game adapter, and a `.gitignore` for root `build/`
from that compiler's bundled starter.
Its parent must exist. Existing folders (even empty ones), files, and symlinks are
refused; no existing project is merged or rewritten. It does not install npm
packages or contact the network. A write failure
removes the new partial folder. `init --json` reports the directory and files.
First-run commands print readable errors to stderr; `doctor` and `init` with
`--json` use the project response envelope on stdout, including failures.

`doctor` reports the CLI/Node versions, built-in OGG readiness, and whether
Chrome can launch. Missing optional Chrome does not cause a failure exit code.
`doctor --json` returns runtime readiness plus supported commands, build
formats, sound synthesis contracts, and workspace schemas without creating project files.
An explicitly configured executable path takes precedence over discovery.

## Build one source

```sh
npx --no-install ashfox build assets/assets/sprites/sword.ashfox --json
```

If an ancestor `.ashfoxworkspace` or `.ashfoxworkspace.mjs` exists, its entire project is built. Selecting
one entry does not bypass project checks. Discovery stops at the nearest Git
root or filesystem root. Invalid configuration fails instead of falling back.
For a standalone source without an ancestor workspace, the CLI reads the entry and its relative import
closure, compiles targets declared in its `outputs { ... }` block (defaulting to
portable `.glb` for models, `.png` for sprites, `.wav` for sounds, and both `.nbt` + `.glb` for structures),
and writes `dist/<entry-id>/build` and `dist/<entry-id>/exports` beside the entry (or at `assets/` root).
A module is not a build entry.

## Build and check a project

```sh
npx --no-install ashfox check game-assets/.ashfoxworkspace
npx --no-install ashfox build game-assets/.ashfoxworkspace --json
npx --no-install ashfox check game-assets/dist/build
```

Pass the `build.directory` (not an export directory) to `check` to verify a built bundle's receipt and hashes.
Passing a workspace validates declared sources and canonical layout (`assets/{models,sprites,sounds,structures,module}/`); passing `--stdin`, `--input-json`, or a standalone `.ashfox` file runs structural inspection and quantitative quality audit (`audit`).
`check` on a workspace does not run OGG encoding or certify target delivery; run `build` to check export constraints, file collisions, and encoding.

## Read the response

Each envelope response has `format: ashfox-cli-result`, `version: 1`, `command`, `ok`,
`diagnostics`, and `result`. On failure, `result` is `null`; read each diagnostic's
`code` and `message`. Do not treat a partial or empty stdout file as success.

A successful build result supplies `requestKey`, `bundleHash`, `bundlePath`,
`catalogPath`, and `exports: [{id, directory}]`. Paths are actual absolute paths
for this machine. The catalog's file paths are relative to `bundlePath`.

| Exit code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Source/compiler or declared build validation failure |
| 2 | Invalid arguments or configuration |
| 3 | I/O, encoder, internal, quality gate, target-export, or integrity failure |
| 4 | Another writer owns an output lock |
| 130 | Cancelled |

Use nonzero as failure; inspect diagnostics for the specific remedy. See
[Troubleshooting](troubleshooting.md) rather than retrying blindly.

## Execution limits

Exports and pack bindings have no fixed count limit.

Compilation runs in a worker with a 120-second limit and a 256 MiB V8 heap limit.
This is not a total process-memory limit. Sources are bounded to 512 files and
8 MiB; filesystem discovery is bounded to 20,000 entries. Configuration is limited
to 256 KiB. Each pack allows at most 8,192 files and 64 MiB before archiving.
Each animated GIF render is limited to 300 frames and 100 million rendered pixels.

SIGINT or SIGTERM cancels ongoing work and preserves the previous selected build.
A final synchronous publication can already have completed when cancellation
arrives. The CLI never rolls back a completed successful publication.

## Render media views

`render` operates on single `.ashfox` sources (file, `--stdin`, or `--input-json`), selecting a named `preview <name> { ... }` declared in the source via `--view <name>` (defaulting to `preview default` or built-in defaults), and writing raw bytes to stdout or `--output <file>` with JSON errors to stderr.
See [Render and check one asset](observe.md) for preview block declarations, memory inputs (`--stdin`, `--input-json`), and headless Chrome options.

| Command | Output | Error channel |
| --- | --- | --- |
| `render` | PNG bytes or animated GIF (`kind = gif;` in preview) | stderr JSON |
| `build` | Immutable bundle + configured GLB/glTF/PNG/WAV/Minecraft outputs | stdout JSON |

`render` rejects `--json` and asset-specific flags (`--camera`, `--gif`, `--cutaway`, etc.); omit `--output` when piping or capturing stdout bytes in code (binary stdout to a TTY is refused).

## Executable project configuration

`check` and `build` accept `.ashfoxworkspace.mjs`, including ancestor discovery
for source builds. This is trusted Node ESM, evaluated to the existing version-2
workspace contract. `init <new-folder>` creates canonical `assets/{models,sprites,sounds,structures,module}/` sources,
this configuration, a game adapter, and a `.gitignore` for root `build/`.
See the [complete convention](repository-layout.md), including evaluation limits,
output identities, and migration from existing JSON workspaces.
