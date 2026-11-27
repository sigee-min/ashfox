# Codebase map

This document maps ownership and dependency boundaries across Ashfox; repository rules remain in [development-manifest.json](../../config/development-manifest.json).

Ashfox assets are authored as native `.ashfox` files. They compile independently,
including their explicit relative imports and virtual `std/...` imports backed by
`library/std/*`. An optional `.ashfoxworkspace` supplies repository-wide selection,
ignore, package, build, pack, and export rules when needed; it is not required to
author or compile an asset. Generated products and receipts are rebuildable outputs.
See [Directory workspace](../guides/workspace.md).

The shared source header is `ashfox 1`. All five asset domains (`model`, `sprite`,
`sound`, `structure`, `vfx`) and `hooks` units share the unified block lexer/parser
in `project/program/syntax/` plus deterministic Damerau-Levenshtein and domain-hint
diagnostics in `project/source/suggest.ts`. Embedded workspace snapshots are an
internal compiler projection, not a fallback when opening a directory project's root
configuration.

`AssetProject` is the transient host session. It binds host id/revision/time,
one validated workspace head, one explicit entry selector, the exact build
identity, and one derived `ProjectDocument`. The document remains the mature
canonical runtime/export view; it contains no source, workspace, selector, or
build identity and is never saved. This avoids forcing renderers and exporters
to interpret authoring records while keeping the workspace as the sole durable
authority.

## Repository layout

| Location | Responsibility |
| --- | --- |
| `apps/cli` | Standalone command-line product (`commands/registry.ts` closed `CLI_COMMANDS` across `init \| doctor \| check \| render \| build \| dev \| library \| docs`, thin `main.ts`, `workerEntry.ts`, `diagnostics.ts`, `observe/`, `dev/`, `library/`, `docs/`, `onboarding/`); `tests/` owns CLI integration scenarios. |
| `apps/site` | Public documentation, landing, and read-only example previews. |
| `packages/engine-core` | Host-independent source contracts, compilation, animation/VFX simulation, hooks validation, commands, and asset export. |
| `packages/asset-build` | Bundle assembly, delivery strategy registry (`bundle/delivery/`), pack builders (`packs/`), and explicit Node I/O adapters (`node/`). |
| `packages/audio-core`, `packages/render-core` | Shared true-stereo DSP audio synthesis and Three.js observation rendering. |
| `packages/internal-contracts` | Closed shared contract guards and schema version authorities. |
| `scripts/{public,skill,showcase,release,quality,docs}` | Repository build, publication, evidence, doctest, and verification automation. |
| `library/`, `showcase/`, `assets/`, `docs/`, `skills/` | Embedded standard library (`library/std/*`), deduplicated `showcase/` workspace, published media, documentation sources, and agent skill sources. |

Local review applications are not release automation. Their npm commands route to
one owning workspace; the former `scripts/audio` and `scripts/items` paths have
no forwarding modules. The former flat build/showcase script paths and `examples/`
are removed. `node_modules/` is the npm development dependency cache, not authored
source or a CLI distribution payload. The released CLI is a bundled standalone CJS
file with embedded standard library (`ASHFOX_STD_LIBRARY`) and documentation
(`ASHFOX_DOCS`) payloads. Generated `dist/`, coverage, and local `.ashfox/` state
are ignored; existing user-authored local workspace state is not erased during
source reorganization.

Within `asset-build`, `bundle/` owns snapshot contracts, assembly, and the closed
`PRODUCT_DELIVERY_REGISTRY` (`bundle/delivery/{contract,model,sprite,sound,structure,vfx,registry}.ts`)
with unified GLB budget evaluation (`evaluateGlbBudget`); `packs/` owns target
dispatch and `game/`/`minecraft/` delivery; `shared/` owns deterministic hash/path
primitives; and `node/` owns filesystem, worker pool/task execution, Vorbis encoding,
stdlib loading, configuration, and publication. Bundle, packs, and shared code
cannot import Node adapters. The public package entry remains `src/index.ts`; moved
implementation paths have no compatibility aliases.

Within the engine, `project/container/` only reads and writes portable workspace
bytes. `commands/workspace/open.ts` compiles and validates the selected entry into
a transient session; `commands/workspace/apply.ts` applies changes. Container
readers cannot import the compiler, validators, or commands. The former
`projectFile/` owner is removed rather than retained as a parallel entry point.

## Canonical build path

~~~text
closed workspace + exact lock + virtual stdlib + selected package entry
  -> workspace/path/package validation
  -> shared ashfox 1 lexing/parsing and nominal module resolution
  -> bounded exact design dependency evaluation and named checks
  -> immutable Typed HIR
  -> immutable instantiated asset plan
  -> rig/skeleton/socket/surface binding and deterministic motion bake
  -> concrete scene, PBR textures, colliders, expressions, and baked clips
  -> independent canonical and target validation
  -> unified export formatting (glTF/GLB, Minecraft, Godot, hook bindings)
  -> CLI capture, review evidence, and game delivery artifacts
~~~

Every phase is fail-closed. A diagnostic or exhausted budget discards the
candidate phase; no partial model or partially updated workspace is returned.
The compiler receives bytes and records in memory and performs no filesystem,
registry, or network access.

## Identities and atomic change

- The workspace hash is the compare-and-swap authority for a multi-file edit.
- The entry closure hash covers the selected entry and every reachable source
  and locked package byte.
- The build key also covers compiler and policy fingerprints.
- The product hash identifies the resulting concrete asset.

An edit supplies one expected workspace hash and one complete change set. The
change contains source writes/deletes and an optional full manifest, never a
caller-authored lock. After structural validation, the engine computes local
package hashes, parser-derived interface hashes, and dependency pins. Embedded
CAS records remain immutable. Strict saved-file opening still validates the
supplied lock; edit resealing is not a compatibility or repair reader.

The candidate package graph and every declared entry must compile before the
workspace head advances; every declared module must be reachable from at least
one entry. Per-file hashes may improve diagnostics but never replace workspace
authority. An unrelated entry may leave another entry's closure and product
hashes unchanged, but the new workspace head and revision invalidate every
accepted review. Review evidence is deliberately bound to the complete build
identity, not only to the selected closure.

## Source-language ownership

| Declaration | Owns | Must not infer |
| --- | --- | --- |
| `design` | exact typed shared values, construction datums, and named boolean checks | a cyclic solution, rounded pixel, extra rig joint, or implicit placement |
| `rig contract` | nominal joints, signed frames, allowed channels, mirror pairs, typed sockets | a match from bone names or similar hierarchy |
| `skeleton` | complete parent-joint-relative rest-frame implementation of one rig | missing joints, axes, scale, or root motion policy |
| `component` | reusable geometry (`cube`, `plane`, `taper`, `wedge`, `cylinder`), colliders, and typed rig/socket/surface ports | caller locals, nearby attachment, or arbitrary parent links |
| `surface contract` | chart layout, dimensions, coverage, slots, and material ABI | a texture/chart pair from unrelated owners |
| `surface` | concrete palette, grain, stamp, chart, PBR `roughness`/`metallic`, expression slots, and raster source | hidden UV, repaint, target fork, or visual repair |
| `motion` | rest-space relative rig-joint rotation/scale/translation tracks, procedural solvers (wave, gait, IK, spring, combat, layers), and expression slot tracks baked to canonical keyframes | name-based retargeting or cross-clip conflict resolution |
| `asset` | concrete skeleton, component instances, surface bindings, socket connections, and motions | automatic assembly or optional connection |

Composition and nominal contracts are the reuse model. Classes, inheritance,
mixins, structural subtyping, general generics, runtime imports, mutable
registries, implicit index resolution, wildcard imports, and target-specific
source branches are not part of Ashfox.

## Ownership

| Decision | Owner |
| --- | --- |
| workspace records, paths, locks, changes, hashes, and graph closure | `packages/engine-core/src/project/workspace/` |
| virtual `std/*` library resolution and catalog descriptors | `packages/engine-core/src/project/stdlib/` (`library/std/*`) |
| shared `ashfox 1` tokens, block parser, and exact expression grammar | `packages/engine-core/src/project/program/syntax/` |
| deterministic fuzzy suggestions and domain docs hints | `packages/engine-core/src/project/source/suggest.ts` |
| package-aware asset AST and parser | `packages/engine-core/src/project/program/asset/` |
| nominal resolution, Typed HIR, instantiation, and concrete lowering | `packages/engine-core/src/compiler/program/asset/` |
| animation curves, quaternions, wave/gait/IK/spring/combat/layer solvers, and clip bake | `packages/engine-core/src/animation/` |
| concrete scene, primitives (`taper`/`wedge`/`cylinder`), colliders, expressions, and PBR textures | `packages/engine-core/src/model/` |
| texture raster, single-source OKLCH color math, PBR maps, and PNG encoding | `packages/engine-core/src/textures/` |
| pure VFX simulation, primitives, dissolve flipbook, and audit (no `export/` import) | `packages/engine-core/src/vfx/` |
| hook schemas/anchors/volumes/cues/meta/zones, modularity guard, and language bindings (`ts`/`cs`/`gd`) | `packages/engine-core/src/hooks/` |
| canonical and target validation | `packages/engine-core/src/validation/` |
| target compatibility and unified artifact bytes (glTF/GLB for model/structure/VFX, Minecraft) | `packages/engine-core/src/export/` |
| structure evaluation (`opContext` + `STRUCTURE_OP_HANDLERS`) and modular `interior/` passes | `packages/engine-core/src/compiler/structure/` |
| directory template compiler pipeline (`registry` + `DOMAIN_ENTRY_COMPILERS`) | `packages/engine-core/src/compiler/directory/` |
| source observation, rendering, check, build, dev, library, docs, and onboarding CLI | `apps/cli/src/` |

Only the asset parser interprets package-aware declarations and imports. Only
the compiler resolves nominal symbols and erases source types. Project-file,
command, CLI, renderer, and export code consume closed public records and do
not import parser or HIR internals.

Layer boundaries are enforced mechanically in `config/development-manifest.json`
under `architecture.forbiddenDependencies`:

- `vfx/` and `animation/` cannot import `export/` (pure domain/simulation cores emit
  intermediate data; `export/targets/gltf/` owns GLB serialization across Model,
  Structure, and VFX via `exporter.ts`, `structureGltf.ts`, and `vfxGltf.ts`).
- `hooks/` cannot import `compiler/` or `export/`; target language emission uses
  the closed `BINDING_EMITTERS` Strategy table in `hooks/bindings/{shared,ts,cs,gd,index}.ts`.
- `project/` and `compiler/` cannot import `commands/` or `validation/`.
- `render-core/` cannot import `apps/cli/src/`.

Design elaboration consumes the sealed parsed closure and substitutes exact
values before HIR; it does not parse again or create another durable source.
Read-only measurements in `model/measurement/` consume concrete products and
expose bounded rest-pose geometry and face UV evidence. Single-asset `check`,
`render`, and `export` support `--stdin` and `--input-json` without touching disk;
build verification binds delivery to its source and output receipts.

## Build replay boundary

Build replay is transient evidence derived from one validated entry build. It
starts from an empty scene, places concrete nodes in deterministic order,
applies each node's complete owning texture set atomically, activates the
selected canonical motion, and holds on the complete model. It is not source,
history, a decision log, or a second receipt.

Replay generation remains bounded and fail-closed. An oversized or stale
replay cannot mutate the workspace, product, review ledger, or artifact.

## Runtime and compatibility boundaries

Typed HIR and instantiated plans are compiler-private and erased before the
runtime product. A concrete product does not retain module, class-like, or
generic objects. A package artifact may deduplicate immutable blobs by digest,
but those blobs do not become a second authoring authority.

## Rig coordinate boundary

Skeleton binds require `parent_origin`; the origin and axes belong to the
parent joint frame. Roots use the model frame. Instantiation composes those
frames for socket placement. The IR retains `parentRestFrame` on bones and
`parentPlacement` on socket connections; there is no ambiguous rest-frame
field or duplicate connection world-frame authority.

Canonical scene pivots form an unrotated bind layout. Runtime adapters subtract
the parent pivot to recover a parent-local translation, then apply the parent's
rotation and scale once. The compiler accumulates offsets for that layout;
it must not copy a local offset directly into a canonical pivot or pre-rotate
an offset that the runtime will rotate again. Socket-owned component geometry
is shifted into this bind layout once, together with its pivots. Cubes, planes,
tapers, wedges, cylinders, and private child bones retain their local shape and
attachment.

## Verification boundary

`npm run quality:check` enforces dependency and owner boundaries, formatting, strict
types, the function complexity ratchet, and the CI Doc-Test gate (`scripts/quality/doctest.js`,
compiling every fenced `ashfox` block in `docs/` and `skills/ashfox/`).
`npm run quality:products` proves that compiled showcase outputs across all domains
(`models`, `sprites`, `vfx`, `sounds`, `structures`, `std`) are byte-identical to their
sealed digests in `scripts/quality/products-baseline/`. Workspace tests prove
closed paths, package/lock consistency, atomic changes, closure identity, and
bounded graphs. Asset compiler tests prove nominal typing, exact frames,
surface/chart ownership, socket cardinality, deterministic instantiation,
motion bake, canonical validity, and target parity. Visual review remains an
independent rendered judgment; it never repairs source or canonical output.

## Multi-domain directory compiler

`compiler/directory/compile.ts` orchestrates workspace validation, virtual `std/*`
merging, modularity checks (`hooks/modularityGuard.ts`), and per-domain compilation
through the template pipeline and `DOMAIN_ENTRY_COMPILERS` registry in
`compiler/directory/registry.ts` across all five asset domains:

- **Model**: compiled through `compiler/program/asset/` with PBR `roughness`/`metallic`,
  `taper`/`wedge`/`cylinder` primitives, `model/collider.ts`, and `model/expression.ts`
  plus `animation/` solvers (`curves`, `quat`, `wave`, `gait`, `ik`, `spring`,
  `combat`, `layers`, `bake`, `motionExpr`).
- **Sprite**: parsed in `project/sprite/`, compiled with OKLCH hue-shifted ramps,
  parametric shapes/masks, 2D patterns, selective outlines, and bounded grain in
  `compiler/sprite/`, evaluated via pure-CPU `audit/sprite/` quality gates, and
  rendered as 512×512 4-panel `--sheet inspect` previews via `spriteInspectSheetPng`.
- **Sound**: parsed in `project/sound/`, synthesized through pure true-stereo DSP in
  `packages/audio-core`, and checked against profile budgets (`impact | foley | creature | magic | ui | ambient`).
- **Structure**: parsed in `project/structure/`, evaluated via `StructureOpContext`
  (`opContext.ts`) and the closed `STRUCTURE_OP_HANDLERS` lookup table across
  `opsVoxel.ts`, `opsArch.ts`, and `opsTransform.ts` with modular `interior/` passes
  (shell, trim, radiosity/bounce, sun shafts, path/enclosure solvers, NBT/item lowering).
- **VFX**: parsed in `project/vfx/`, simulated and audited in pure `vfx/` (primitives,
  voxel burst particles, dissolve flipbooks, shared OKLCH math from `textures/oklch.ts`),
  and emitted as unlit glTF/GLB via `export/targets/gltf/vfxGltf.ts` and `vfxState.ts`.
- **Hooks**: parsed and validated in `hooks/` (`schema`, `anchor`, `volume`, `cue`,
  `meta`, `zone`), checked workspace-wide by `modularityGuard`, and emitted into
  `.d.ts`, `.cs`, and `.gd` bindings via `hooks/bindings/`.

## CLI command dispatch & resource-pack delivery

`apps/cli/src/main.ts` dispatches main-thread invocations to `commands/registry.ts`
(`CLI_COMMANDS`: `init`, `doctor`, `check`, `render`, `build`, `dev`, `library`, `docs`)
and worker-thread executions to `workerEntry.ts` (`executeWorker` / `isPoolWorker`) or
the `asset-build` persistent worker pool.

Optional directory `packs` declarations bind named exports to item, model, structure,
VFX, and sound resources. The directory owner validates the closed configuration;
`asset-build` dispatches delivery through `PRODUCT_DELIVERY_REGISTRY`, assembles bytes
and archives, and its Node adapters own built-in WASM Vorbis encoding and publication.
See [resource-pack configuration](../guides/minecraft-packs.md). Pack-format choices are
project data; changing a version label does not change the source compiler.

The sibling `game_assets` pack emits engine-neutral GLB/PNG/audio, hook bindings,
and a closed runtime manifest. CLI GLB exports choose portable encoding by default,
with optimized encoding explicit in workspace exports. See [game assets](../guides/game-assets.md).

## Shared observation renderer

`packages/render-core` owns Three scene projection, camera presets, materials,
animation sampling, capture surfaces, and deterministic build replay across models,
structures, and VFX. CLI observation consumes its public entry points. The landing
loads exported GLB with a read-only viewer. CLI bundles the headless browser entry
and drives it through a private Chrome pipe, with no network endpoint.
`apps/cli/src/observe` owns closed stdin contracts, isolated source compilation,
and binary stdout. See [the observation guide](../guides/observe.md).

## Executable repository configuration

The Node asset-build adapter evaluates `.ashfoxworkspace.mjs` in a separate Node
process and passes its JSON result through the same closed directory reader.
Engine-core remains host-independent. Snapshot verification re-evaluates the
configuration before publication. The evaluator is trusted project code, not a
sandbox. `scripts/release/project/` owns the grouped CLI init template and sample
consumer adapter; the portable release ZIP remains the standalone asset sample.
