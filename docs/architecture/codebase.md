# Codebase map

See [the source and CLI product boundary](product-boundary.md) for the division
between asset authoring, game delivery and the public website.

Ashfox assets are authored as native `.ashfox` files. They compile independently,
including their explicit relative imports. An optional `.ashfoxworkspace` supplies
repository-wide selection, ignore, package, build and export rules when needed;
it is not required to author or compile an asset. Generated products and receipts
are rebuildable outputs. See [Directory workspace v2](../guides/workspace.md).

The source header remains `ashfox-model 1`. Native sprite units share the lexer
and compile beside existing model entries. The former embedded v1 workspace is
an explicit import format and an internal model-compiler projection; it is not
a fallback when opening a directory project's root configuration.

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
| `apps/cli` | Standalone command-line product; `src/` owns execution and `tests/` owns CLI integration scenarios. |
| `apps/site` | Public documentation, landing and read-only example previews. |
| `apps/audio-study`, `apps/item-study` | Independent local source/result review tools with their own npm workspaces. |
| `apps/blockbench-*` | Optional supported Blockbench entry points. |
| `packages/engine-core` | Host-independent source contracts, compilation, commands and asset export. |
| `packages/asset-build` | Bundle assembly, delivery targets and explicit Node I/O adapters. |
| `packages/audio-core`, `packages/render-core` | Shared audio synthesis and observation rendering. |
| `packages/*contracts`, `packages/blockbench-*` | Shared contracts and the supported Blockbench runtime/conformance implementation. |
| `scripts/{public,blockbench,skill,showcase,corpus,release,quality,docs}` | Repository build, publication, evidence and verification automation. |
| `examples/`, `assets/`, `docs/`, `skills/` | Native examples, published media, documentation sources and agent skill sources. |

Local review applications are not release automation. Their npm commands route to
one owning workspace; the former `scripts/audio` and `scripts/items` paths have
no forwarding modules. The former flat build/showcase script paths are removed.
`node_modules/` is the npm development dependency cache, not authored source or
a CLI distribution payload. The released CLI is a bundled standalone CJS file.
Generated `dist/`, coverage, and local `.ashfox/` state are ignored; existing
user-authored local workspace state is not erased during source reorganization.

Within `asset-build`, `bundle/` owns snapshot contracts and assembly, `packs/`
owns target dispatch and `game/`/`minecraft/` delivery, `shared/` owns deterministic
hash/path primitives, and `node/` owns filesystem/configuration/encoding/publication.
Bundle and pack code cannot import Node adapters. The public package entry remains
`src/index.ts`; moved implementation paths have no compatibility aliases.

Within the engine, `project/container/` only reads and writes portable workspace
bytes. `commands/workspace/open.ts` compiles and validates the selected entry into
a transient session; `commands/workspace/apply.ts` applies changes. Container
readers cannot import the compiler, validators, or commands. The former
`projectFile/` owner is removed rather than retained as a parallel entry point.

## Canonical build path

~~~text
closed workspace + exact lock + selected package entry
  -> workspace/path/package validation
  -> source parsing and nominal module resolution
  -> bounded exact design dependency evaluation and named checks
  -> immutable Typed HIR
  -> immutable instantiated asset plan
  -> rig/skeleton/socket/surface binding and deterministic motion bake
  -> concrete scene, textures, and animations
  -> independent canonical and target validation
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
| `skeleton` | complete parent-relative rest-frame implementation of one rig | missing joints, axes, scale, IK, or root motion policy |
| `component` | reusable geometry and typed rig/socket/surface ports | caller locals, nearby attachment, or arbitrary parent links |
| `surface contract` | chart layout, dimensions, coverage, slots, and material ABI | a texture/chart pair from unrelated owners |
| `surface` | concrete palette, grain, stamp, chart, and raster source | hidden UV, repaint, target fork, or visual repair |
| `motion` | rest-relative rig-joint rotation/scale tracks | name-based retargeting, position semantics, IK, or conflict resolution |
| `asset` | concrete skeleton, component instances, surface bindings, socket connections, and motions | automatic assembly or optional connection |

Composition and nominal contracts are the reuse model. Classes, inheritance,
mixins, structural subtyping, general generics, runtime imports, mutable
registries, implicit index resolution, wildcard imports, and target-specific
source branches are not part of Ashfox v1.

## Ownership

| Decision | Owner |
| --- | --- |
| workspace records, paths, locks, changes, hashes, and graph closure | `packages/engine-core/src/project/workspace/` |
| v1 source tokens and exact expression grammar | `packages/engine-core/src/project/program/syntax/` |
| package-aware asset AST and parser | `packages/engine-core/src/project/program/asset/` |
| nominal resolution, Typed HIR, instantiation, and concrete lowering | `packages/engine-core/src/compiler/program/asset/` |
| concrete scene and product contracts | `packages/engine-core/src/model/` |
| texture raster and PNG encoding | `packages/engine-core/src/textures/` |
| canonical and target validation | `packages/engine-core/src/validation/` |
| target compatibility and artifact bytes | `packages/engine-core/src/export/` |
| source observation, capture and stdio session revisions | `apps/cli/src/observe/` |
| optional Blockbench compatibility route | `packages/blockbench-runtime/src/` |

Only the asset parser interprets package-aware declarations and imports. Only
the compiler resolves nominal symbols and erases source types. Project-file,
command, CLI, renderer, and export code consume closed public records and do
not import parser or HIR internals.

Design elaboration consumes the sealed parsed closure and substitutes exact
values before HIR; it does not parse again or create another durable source.
Read-only measurements in `model/measurement/` consume concrete products and
expose bounded rest-pose geometry and face UV evidence. CLI stdio sessions bind source replacement to the current revision; build
verification binds delivery to its source and output receipts.

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

Blockbench remains an optional compatibility product. It may consume public
engine contracts for transient conversion, while engine-core cannot import upward into any host.

## Rig coordinate boundary

Skeleton binds require `parent-origin`; the origin and axes belong to the
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
and private child bones retain their local shape and attachment.

## Verification boundary

`npm run quality:architecture` enforces dependency and owner boundaries.
`npm run quality:manifest` verifies repository policy. Workspace tests prove
closed paths, package/lock consistency, atomic changes, closure identity, and
bounded graphs. Asset compiler tests prove nominal typing, exact frames,
surface/chart ownership, socket cardinality, deterministic instantiation,
motion bake, canonical validity, and target parity. Visual review remains an
independent rendered judgment; it never repairs source or canonical output.

## Item sprite and directory compiler

The sprite compiler reads native `.ashfox` in `project/sprite/`, lowers
form-based tone and bounded grain in `compiler/sprite/`, and reuses the canonical
texture raster and PNG encoder. Its public entry points are `readItemStudy`,
`compileItemStudy`, `spritePreviewPng`, and `spriteSheetPng`. The native
`parseSpriteSource` front end lowers into the same validated plan. Directory
configuration lives in `project/directory/`; `compiler/directory/` compiles
model and sprite entries through `compileDirectoryWorkspace` without empty model documents.

`apps/item-study/` owns complete preview snapshots and the read-only source/result
studio. Source edits and delivery use the common native CLI. The obsolete JSON
candidate harness and item-specific CLI forwarding entry are removed. Style-related
mechanical constraints are enforced by the compiler profile. See
[the item design](item-sprites.md) and [the studio](../../apps/item-study/README.md).

## CLI resource-pack delivery

Optional directory `packs` declarations bind named exports to item and sound
resources. The directory owner validates the closed configuration; asset-build
assembles bytes and archives, and its Node adapters own FFmpeg and publication.
See [resource-pack configuration](../guides/minecraft-packs.md). Pack-format choices are
project data; changing a version label does not change the source compiler.

The sibling `game_assets` pack emits engine-neutral GLB/PNG/audio and a closed
runtime manifest. CLI GLB exports choose portable encoding by default, with
optimized encoding explicit in workspace exports. See [game assets](../guides/game-assets.md).

## Shared observation renderer

`packages/render-core` owns Three scene projection, camera presets, materials,
animation sampling, capture surfaces and deterministic build replay. CLI observation consumes its public entry points. The landing loads exported
GLB with a read-only viewer. CLI bundles
the headless browser entry and drives it through a private Chrome pipe, with no
network endpoint. `apps/cli/src/observe` owns closed stdin contracts, isolated
source compilation, revision-guarded in-memory sessions and binary stdout.
See [the observation guide](../guides/observe.md).

## Executable repository configuration

The Node asset-build adapter evaluates `.ashfoxworkspace.mjs` in a separate Node
process and passes its JSON result through the same closed directory reader.
Engine-core remains host-independent. Snapshot verification re-evaluates the
configuration before publication. The evaluator is trusted project code, not a
sandbox. `scripts/release/project/` owns the grouped CLI init template and sample
consumer adapter; the portable release ZIP remains the standalone asset sample.
