# Changelog

## [2.0.0](https://github.com/sigee-min/ashfox/compare/v1.0.0...v2.0.0) (2026-09-13)


### ⚠ BREAKING CHANGES

* **audio:** sound sources must use voices, sequences, playback and fixed output gain. Legacy layer, contour, sweep and RMS fields are rejected. Loop delivery requires WAV.
* **ci:** CLI installation and repository development require Node.js 24 or newer. Remove Node.js 20 release testing and update installation guidance.
* Remove the browser Workbench and DOM agent API. Asset authoring now uses native .ashfox sources and the CLI; reinstall the updated asset skill when migrating from the browser workflow.

### Features

* **audio:** add expressive sound sequencing and deterministic loops ([81590d9](https://github.com/sigee-min/ashfox/commit/81590d9142df47f918f637dafa39fc92db72d811))
* **audio:** synthesize expressive birdsong from native source ([ac57746](https://github.com/sigee-min/ashfox/commit/ac57746755721f0ef34fd95fe0e96c655c6b1e4c))
* **cli:** add programmable asset workspace conventions ([ade602f](https://github.com/sigee-min/ashfox/commit/ade602f69b4b38374f3ae655d98afdf1f6827c38))
* **docs:** add Korean localization and clarify contributor guides ([746ed26](https://github.com/sigee-min/ashfox/commit/746ed26167b72f76ebc5c2e7ae48c69dbf695a71))
* **site:** refine landing showcases and replay interactions ([f9dd745](https://github.com/sigee-min/ashfox/commit/f9dd74595e2366e4403ff7ad4e9d753138807270))
* unify asset authoring around the CLI and agent onboarding ([22f07b0](https://github.com/sigee-min/ashfox/commit/22f07b0e477b8fac2725940e21dea68031e45866))


### Bug Fixes

* **cli:** await graceful Chrome shutdown before profile cleanup ([bad5d2b](https://github.com/sigee-min/ashfox/commit/bad5d2bba14e665268e59e34bfa808651ce30ded))
* **site:** align docs link with header actions ([ebe18c0](https://github.com/sigee-min/ashfox/commit/ebe18c0513373e4df79fc2c7f59de013001d9f7e))
* **site:** preserve layout when replay locks background scrolling ([0ea5a6b](https://github.com/sigee-min/ashfox/commit/0ea5a6ba3a3408877a31019f595c15f0e653b969))
* **site:** resolve static files before directory indexes on Node 20 ([1a7800e](https://github.com/sigee-min/ashfox/commit/1a7800e6ac14a16a7a3626216568ac7d52bac8aa))
* **site:** simplify hero navigation and compact setup guidance ([2fefbf8](https://github.com/sigee-min/ashfox/commit/2fefbf826d397d963e895e1fb438f75e9330f995))


### Miscellaneous Chores

* **ci:** require Node.js 24 and replace retired action runtimes ([e3d7414](https://github.com/sigee-min/ashfox/commit/e3d7414879838131d902292c7107b461188cca6b))

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
