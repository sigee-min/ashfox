# Changelog

## [1.0.0](https://github.com/sigee-min/ashfox/releases/tag/v1.0.0) (2026-09-10)

### Assets as Code

* Define voxel-game models, pixel textures and procedural sounds in native `.ashfox` source, version them in Git, and compile game-ready outputs.
* Explore Griffin, fox and goblin examples with animated GLBs, source files and build replays.
* Follow the source-to-game workflow and adoption guide from the refreshed README and dark landing page.

### CLI and delivery

* Add `--help`, `--version`, `doctor` and offline `init` for a complete first-run experience.
* Remove export and pack-binding count limits, including game runtime manifest ingestion. Regression tests build 129 native assets in one workspace.
* Build portable GLB, PNG and WAV outputs, Minecraft resource packs, and engine-neutral game bundles with reproducible receipts and atomic publication.
* Validate installed CLI commands and stdio sessions on Linux, macOS and Windows with Node.js 20 and 24.
* Publish matching CLI, starter and checksum artifacts as an immutable GitHub release.

### Compatibility and release reset

* This release replaces the earlier mutable v1.0.0 and retires the older GitHub releases at the maintainer's request. The v1.0.0 download URL now serves new bytes. Existing lockfiles referencing the previous archive integrity must be updated by reinstalling the release dependency; do not bypass integrity verification.
* Native source uses `ashfox-model 1`; optional directory configuration uses `.ashfoxworkspace` version 2. Legacy embedded workspace and compiler-lock formats require explicit migration or re-export.
* Skeleton binds require `parent-origin`. Legacy intent-program and runtime contracts are not compatibility aliases.
* Node.js 20+ is required. Chrome is optional for capture, and FFmpeg with libvorbis is optional for OGG audio.

## [0.2.0](https://github.com/sigee-min/ashfox/compare/v0.0.5...v0.2.0) (2026-08-08)

### Features

* add the local-first AI-native web workbench with browser agent control, project persistence, visual review, capture, and artifact delivery
* add a deterministic explicit-model authoring kernel with bounded source-visible composition and target-independent canonical output
* add source-owned pixel textures, explicit animation, and target-aware production readiness
* add optimized Java block, GeckoLib 5, Bedrock, glTF, and GLB export pipelines without rewriting canonical project data
* add public guides and a portable ashfox agent skill

### Quality and Reliability

* enforce one mutation and delivery authority across the engine, web workbench, and agent command port
* add revision-safe atomic commands, deterministic capture receipts, visual-review evidence, and export adaptation receipts
* add architecture, dead-code, coverage, conformance, site, and release quality gates
* harden Blockbench MCP modeling, texture, animation, preview, and export workflows

## [0.0.5](https://github.com/sigee-min/ashfox/compare/v0.0.4...v0.0.5) (2026-02-26)

### Bug Fixes

* persist endpoint host/port/path settings across plugin reloads and expose runtime server mode/status
* fix `ensure_project` delete flow when Blockbench close is async
* harden `paint_mesh_face` commit validation by reading updated canvas source first
* harden native export compatibility around `compileAdapter` failures and fallback handling
* add regression tests for endpoint persistence, runtime status, texture source selection, export fallback, and async close
