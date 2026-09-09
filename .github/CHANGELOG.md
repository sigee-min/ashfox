# Changelog

## [1.0.0](https://github.com/sigee-min/ashfox/compare/v0.2.0...v1.0.0) (2026-09-09)


### ⚠ BREAKING CHANGES

* unify native asset pipelines and user documentation
* **showcase:** Skeleton binds require parent-origin. Ambiguous origin binds and previous compiler locks are rejected.
* **contracts:** replace runtime manifest v3 and the dated tool schema identifier with v1 without migration or compatibility aliases.
* complete precision asset authoring and griffin showcase ([#11](https://github.com/sigee-min/ashfox/issues/11))
* **agent:** replace the side camera with explicit left and right cameras and require runtime manifest version 3 review checks.
* **agent:** workspace edits reject changes.lock and the runtime manifest is schema v2. The skill sync helper requires --install for updates and no longer accepts --check.
* require the design and anchored-pixel compiler fingerprint in workspace locks. Reject prior compiler locks without a compatibility reader or implicit migration.
* Legacy intent-program, single-project, generated-surface, and result-capture contracts are removed; consumers must use the v1 asset workspace and build-replay APIs.
* remove legacy project, Intent Program, and compatibility contracts in favor of current V1 source-only workflows.

### Features

* add exact precision modeling and pixel anchors ([92a1ddb](https://github.com/sigee-min/ashfox/commit/92a1ddb77a891ff65d6b230bcd948d91a884e95a))
* **agent:** make workspace edits self-sealing ([bfea0d3](https://github.com/sigee-min/ashfox/commit/bfea0d3f87922c9025d5ada905bcc80ff82fdbf6))
* **agent:** require bilateral review and support stamp reflection ([160644b](https://github.com/sigee-min/ashfox/commit/160644b297498c0c4e88f193ffe60390885c9435))
* complete precision asset authoring and griffin showcase ([#11](https://github.com/sigee-min/ashfox/issues/11)) ([08895e1](https://github.com/sigee-min/ashfox/commit/08895e10b54dc271ad8e02a9e816b6e0793216d5))
* hardcut canonical intent compiler workflow ([2786126](https://github.com/sigee-min/ashfox/commit/27861264e7674496fe39be3623e7db75cffa93fc))
* harden intent program compiler contract ([a69d63d](https://github.com/sigee-min/ashfox/commit/a69d63d2e1e6c111b911d811aa485114ebcd3bbe))
* **release:** distribute versioned CLI assets through GitHub ([033712f](https://github.com/sigee-min/ashfox/commit/033712fd64ffe8458763fbdab462f018b4f37ceb))
* replace legacy authoring with asset workspaces ([0b838f9](https://github.com/sigee-min/ashfox/commit/0b838f90a53f547102e52ea1492a22f4551d1a00))
* **showcase:** complete creature showcase and user documentation ([a897d22](https://github.com/sigee-min/ashfox/commit/a897d22160701880bbdde31f79514d72f34e38ac))
* **showcase:** publish griffin example with six animations ([4bfec1b](https://github.com/sigee-min/ashfox/commit/4bfec1b901c5390e337ddbf8e907bfac111fc0a6))
* **site:** launch an animated interactive asset landing ([d692874](https://github.com/sigee-min/ashfox/commit/d692874e6835ec15ede9c32863caabb2d3710bb0))
* unify native asset pipelines and user documentation ([4d70750](https://github.com/sigee-min/ashfox/commit/4d7075012adec1fa26ac5cef4565843a60334992))


### Bug Fixes

* **release:** install workspace dependencies before release operations ([ac1804f](https://github.com/sigee-min/ashfox/commit/ac1804fb5d4c39d4ec34131ea1982393cfbd7a45))
* **web:** complete agent review and capture workflow ([fb9e4d0](https://github.com/sigee-min/ashfox/commit/fb9e4d02c3035eeae15d91d6dd5159aa04edf243))
* **web:** preserve canonical texture bytes during export ([51a31c8](https://github.com/sigee-min/ashfox/commit/51a31c81ff93605da14723d644078b8c1342e4d9))
* **web:** restore file operation liveness after effect replay ([cb001c0](https://github.com/sigee-min/ashfox/commit/cb001c0056ce91f16416a6f20ec03216bee22cd8))


### Code Refactoring

* **contracts:** unify internal schemas at v1 ([7e36612](https://github.com/sigee-min/ashfox/commit/7e366121a9eccfd71fab03fce569805fde38f0d0))
* hard-cut intent program v1 architecture ([ce1d53f](https://github.com/sigee-min/ashfox/commit/ce1d53f87b67e5a8bb4188ad9da35b9b1d838dee))

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
