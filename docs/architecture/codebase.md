# Codebase map

Ashfox has one durable authoring authority: a closed asset workspace. The
workspace contains normalized `.ashfox` source files, package manifests, and
an exact content-addressed lock. A selected package entry compiles to one
concrete asset. Scene data, texture rasters, animation channels, previews,
reviews, exports, and caches are rebuildable products rather than editable
authority.

The source header remains exactly `ashfox-model 1`. The hard cut has no
single-source compatibility reader, alias grammar, mutable dependency range,
or host-path fallback.

The portable file is canonical `.ashfoxworkspace` JSON
(`application/vnd.ashfox.workspace+json`) with exactly one trailing LF. It is
the workspace authority, not a wrapper around a compiled `ProjectDocument`.

`AssetProject` is the transient host session. It binds host id/revision/time,
one validated workspace head, one explicit entry selector, the exact build
identity, and one derived `ProjectDocument`. The document remains the mature
canonical runtime/export view; it contains no source, workspace, selector, or
build identity and is never saved. This avoids forcing renderers and exporters
to interpret authoring records while keeping the workspace as the sole durable
authority.

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
  -> Web review, replay, and delivery artifacts
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
| workspace persistence, passive inspection, review, and delivery UI | `apps/web/src/` |
| optional Blockbench compatibility route | `packages/blockbench-runtime/src/` |

Only the asset parser interprets package-aware declarations and imports. Only
the compiler resolves nominal symbols and erases source types. Project-file,
command, Web, renderer, and export code consume closed public records and do
not import parser or HIR internals.

Design elaboration consumes the sealed parsed closure and substitutes exact
values before HIR; it does not parse again or create another durable source.
Read-only measurements in `model/measurement/` consume concrete products and
expose bounded rest-pose geometry and face UV evidence. The Web agent binds
these observations to the complete current revision/workspace/build guards.

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
engine contracts for transient conversion, but Web cannot depend on its
runtime and engine-core cannot import upward into either host.

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
