# Compiler complexity and performance

This change removes redundant work within a build. It does not introduce a disk
cache, change source contracts, or bypass checks for unexported entries.

## Cost model

Let `S` be total source bytes, `F` source files, `E` model entries, `T` export
requests, `U` distinct exported models, and `C_i` each entry's semantic lowering,
texture compilation and motion bake cost. Let `L_i` be the size of its reachable
source/import closure, and `P_i` the resulting concrete model size.

| Work | Before | After |
| --- | --- | --- |
| Reading/validating the entire model workspace for entry passes | Repeated `O(E × S)` source scans, plus manifest/graph checks | A fixed number of `O(S)` scans per build; entry closure traversal remains necessary |
| Model source parsing | Whole validation plus repeated parsing of each selected closure | One parser cache per validated invocation; each source parsed once in that pass |
| Directory model lowering | `2 × sum(C_i)` for validation and then result collection | `sum(C_i)`; validated products become the directory result |
| Source lookup and export-to-product lookup | Linear search per request, `O(F² + E × F + T × E)` | Indexed lookups, expected `O(F + E + T)` for these operations |
| Sprite module parsing | Shared modules parsed again for each sprite entry | Shared parse results within the directory build; each entry still traverses and validates its own import graph |
| Export project opening and authority compilation | Twice per model export request | Twice per distinct exported model; immutable authority snapshots reused after successful verification |

These are bounds on the affected operations, not a claim that the entire compiler
is linear. Deterministic sorting, dependency traversal, source-content hashing,
geometry/texture lowering and actual artifact encoding remain. Different entries
still receive independent semantic lowering even when they import the same module.
Sound synthesis remains proportional to scheduled frames and per-frame DSP work;
this change only avoids an extra generic lexer pass used to classify entries.

## Memory and invalidation

The model parser snapshot owns `O(S)` parsed source data and file/package indexes
for one invocation. It is discarded after whole-workspace validation and lowering.
Directory compilation must retain its accepted products, `O(sum(P_i))`; collecting
them reuses the validation result instead of constructing it a second time. Atomic
workspace edits do not retain products that their callers do not need.

The bundle keeps one opened project for an entry only while further exports of
that entry remain, then removes it. Export authority snapshots use a `WeakMap`
keyed by the exact project object. Only successful snapshots of recursively frozen
plain data with own authority fields qualify. Immutability is established before
copying or validating the snapshot, including when Proxy traps have side effects.
Mutable children, accessors and
forgeries continue through complete verification. The cache neither authorizes a
structurally similar object nor keeps a discarded project alive. Additional live
snapshots cost `O(sum(P_i))` over retained projects; output bytes still cost their
actual total size. We do not trade correctness for a shallow-freeze shortcut.

Every fresh compiler invocation gets new parser state and rechecks limits and
source authority. Entry closure, product, workspace and bundle hashes remain
unchanged. Unexported invalid entries and unreachable modules still reject the
entire build. Mutation during asynchronous export still invalidates lineage.

## Reproduce the measurement

```sh
node scripts/corpus/compiler.js --compare 670b541613d335224bb9bc423cd30cde99d9c912 /tmp/compiler-comparison.json
```

The runner builds isolated baseline and working-tree bundles without changing the
checkout. For each case it runs the baseline followed by the candidate in separate
Node processes, warms up once, then records five runs with GC before each run.
Times exclude process startup and verification serialization. Peak RSS includes
the whole case process, warmup and output hashing; heap deltas are GC-sensitive
and are not peak heap measurements. Results vary with host load and thermal state.

The fixture creates 1, 8 or 24 distinct fox entries sharing three source modules.
Export cases build one model into 1 or 4 portable GLB targets. Every repetition
checks its complete output hash; paired runs also assert baseline/candidate hash
equality, covering source identity, products, artifacts and receipts.

First-phase measurements on Node 24.13.1, macOS arm64, 2026-09-13, before the
texture optimizations below. Raw results and hashes are in
[compiler-performance.json](compiler-performance.json).

| Case | Before median ms | After median ms | Speedup | Process peak RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| `models-1` | 76.2 | 39.2 | 1.94× | 159.8 → 126.4 |
| `models-8` | 396.6 | 164.3 | 2.41× | 247.0 → 171.9 |
| `models-24` | 1465.0 | 525.4 | 2.79× | 297.3 → 254.9 |
| `exports-1` | 201.3 | 166.9 | 1.21× | 219.4 → 179.2 |
| `exports-4` | 531.1 | 329.1 | 1.61× | 286.9 → 286.1 |

The largest measured model case reduced time by about 64% and peak process RSS by
about 14%. Multiple exports improved time but did not materially reduce peak RSS;
encoded artifacts and export processing remain significant in that case.

## Regression coverage

- Shared modules use the same parsed unit within an invocation, but fresh
  invocations and tighter limits cannot reuse old parser authority.
- Directory builds reject semantically invalid unexported entries and orphan modules.
- Export snapshots distinguish immutable data from mutable, shallow-frozen,
  accessor-backed and forged projects.
- Existing atomic edit, stale-source, cancellation, async export mutation,
  cold-build determinism and CLI integration suites remain required.

## Further texture optimization

For `B` raster bytes, PNG encoding still takes `Θ(B)` time. It now writes stored
DEFLATE blocks directly into an exactly sized final `Uint8Array`, eliminating
full-size scanline, compression, chunk and final JavaScript number arrays.
Auxiliary space beyond the input and final output changes from `Θ(B)` to `O(1)`.
A fixed CRC lookup table and bounded Adler accumulation reduce per-byte work;
canonical filter choice, block boundaries, checksums and output bytes stay intact.

An exact immutable byte view created by the raster constructor is registered in
a private `WeakSet`. Its private backing buffer never escapes. After checking the
raster shape and dimensions, byte validation for these views takes `Θ(1)` instead
of `Θ(B)`. Foreign views still receive full byte validation on every call and
cannot acquire this trust merely by passing validation once.

GLTF texture input copying uses intrinsic typed-array branding and copying, while
preserving rejection of extra keys, subclasses, forged brands, detached buffers
and proxies. This removes per-byte descriptor allocations. Time and temporary
key-enumeration space remain `Θ(B)`; this is not a constant-space validator.
Bundle exports also encode blob textures only when the selected exporter requests
them, avoiding unused rasterization and encoding for other targets.

The following paired measurement compares the **first-phase working-tree bundle**
against the additional texture changes, using the same host and five-run median
procedure. It is not a comparison against the original Git revision. All seven
paired output hashes match. Raw results, including the baseline bundle hash, are
in [compiler-textures.json](compiler-textures.json).

| Case | Previous median ms | New median ms | Speedup | Process peak RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| `models-1` | 39.8 | 36.2 | 1.10× | 125.9 → 123.2 |
| `models-8` | 167.5 | 170.3 | 0.98× | 171.3 → 170.1 |
| `models-24` | 437.5 | 385.1 | 1.14× | 269.1 → 261.5 |
| `exports-1` | 158.0 | 145.8 | 1.08× | 182.9 → 177.5 |
| `exports-4` | 323.2 | 297.9 | 1.09× | 282.8 → 284.8 |
| `png-256` | 21.8 | 3.2 | 6.82× | 144.8 → 82.6 |
| `png-1024` | 276.3 | 32.6 | 8.49× | 465.6 → 92.7 |

PNG cases time encoding of a prebuilt raster, excluding rasterization. Their
process RSS includes raster creation and output hashing. The 1024-square case
uses about 80% less peak process RSS. General model/export improvements are much
smaller, and some measurements are slightly worse; the encoder speedup does not
describe whole-build performance.

The runner now includes the two PNG cases. For future incremental comparisons,
save a baseline bundle before editing, then compare it with the changed tree:

```sh
node scripts/corpus/compiler.js --snapshot /tmp/compiler-before.cjs
# Apply the optimization.
node scripts/corpus/compiler.js --compare-bundle /tmp/compiler-before.cjs /tmp/compiler-after.json
```

The Git-revision comparison above now measures all current changes together.
PNG regressions use original-encoder golden hashes plus independent zlib inflate
and bitwise CRC checks, including exact 65535-byte block boundaries and row
crossings. Additional tests cover mutable foreign raster views, incorrect
dimensions, forged typed-array brands, detached buffers and offset-view copies.

## Further digest optimization

SHA-256 previously copied the complete input into a padded buffer and destructured
the eight state words through typed-array iteration for every 64-byte block. It
now reads complete blocks directly from the input, pads only the last 64 or 128
bytes, and reads state words by index. Time remains `Θ(B)`, with less per-block
iteration work. For `Uint8Array` input, auxiliary memory is now `O(1)` instead of
`Θ(B)`: at most 128 padding bytes, 256 schedule bytes and 32 state bytes, plus
fixed constants and scalars. Other array-like inputs still require `Θ(B)` byte
normalization, and string hashing still allocates its UTF-8 encoding.

This synchronous implementation remains host-independent and uses the same
SHA-256 rounds and public digest format. It introduces no digest cache. Tests
compare with Node's independent crypto implementation at padding boundaries
(55/56, 63/64, 119/120 and 127/128 bytes), for offset views, array-like coercion,
Unicode, empty input and large inputs, and check that source bytes are unchanged.

The following paired measurement compares the completed texture optimization
against these digest changes, on the same Node 24.13.1/macOS arm64 host using the
same five-run median procedure. All nine paired output hashes match. The two new
hash cases time only hashing a prebuilt 1 MiB or 16 MiB byte array; process RSS
includes that input. Raw results are in [compiler-digest.json](compiler-digest.json).

| Case | Previous median ms | New median ms | Speedup | Process peak RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| `models-1` | 36.6 | 24.3 | 1.51× | 122.8 → 122.8 |
| `models-8` | 157.7 | 101.5 | 1.55× | 169.6 → 171.6 |
| `models-24` | 454.9 | 234.7 | 1.94× | 261.2 → 259.3 |
| `exports-1` | 148.0 | 113.5 | 1.30× | 180.8 → 177.4 |
| `exports-4` | 299.3 | 238.4 | 1.26× | 284.9 → 282.6 |
| `png-256` | 3.3 | 3.4 | 0.97× | 82.8 → 82.6 |
| `png-1024` | 34.2 | 34.3 | 1.00× | 92.4 → 92.4 |
| `hash-1048576` | 22.3 | 6.6 | 3.38× | 84.9 → 80.9 |
| `hash-16777216` | 315.9 | 55.0 | 5.74× | 114.3 → 96.1 |

Model compilation benefits because source and product provenance use this same
digest implementation. PNG encoding itself does not call the digest and remains
essentially unchanged. Whole-build peak RSS also changes little: this optimization
primarily reduces hashing time and the temporary memory of large byte digests.
The snapshot/compare-bundle workflow above reproduces incremental comparisons;
the benchmark now includes all nine cases.

## Linear parent-cycle validation

Final scene validation previously followed each node's parent chain independently.
A chain of `N` nodes required `Θ(N²)` parent visits and repeatedly allocated visited
sets. For unique node IDs, validation now memoizes the outcome of each path, taking
`Θ(N)` time and `O(N)` auxiliary space. The previous worst-case live space was also
`O(N)`; the improvement removes repeated traversal and allocation, not the need to
store a deep path. Traversal is iterative and does not grow the call stack.

The memo records the same cycle entry each starting node would have reported.
Nodes within a cycle report themselves; branches report the first cycle node they
reach. Output follows the original node order. Missing parents and roots terminate
the walk as before. Duplicate IDs already fail scene validation and retain the
original first-match traversal, including its diagnostic multiplicity and worst-case
quadratic cost. Other parent and root validation remains unchanged.

The incremental baseline contains the previous traversal extracted unchanged into
the internal helper. The new benchmark cases time only that helper over prebuilt
chains and indexes. They illustrate deep hierarchy scaling, not whole-build speed.
All eleven paired output hashes match; complete results, including ordinary cases
with mixed timing changes, are in [compiler-parents.json](compiler-parents.json).

| Parent chain | Previous median ms | New median ms | Speedup | Process peak RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| 1,000 nodes | 14.81 | 0.07 | 205.89× | 82.4 → 80.1 |
| 4,000 nodes | 196.44 | 0.53 | 370.06× | 94.7 → 81.4 |

Measurements use the same five-run median, Node 24.13.1/macOS arm64 procedure.
Short, shallow scenes do not establish a whole-build speedup in this measurement;
ordinary cases include both improvements and regressions amid host timing variation.
The guaranteed improvement is the unique-ID graph traversal bound. Regression tests
compare complete cycle-report sequences against the old algorithm over 300 generated
graphs in both orders, including duplicates, and bound parent reads on a 20,000-node
chain without timing assertions.

The benchmark now includes eleven cases. The parent helper did not exist at the
original Git revision; use a saved bundle containing the previous traversal for
an incremental parent-case comparison. Git-revision comparisons omit these two
new helper cases because they have no standalone historical API.

## Indexed geometry and surface lookup

Geometry structure validation previously searched all flattened records for every
face's parent. With `R` records and `F` faces this costs `O(F × R)`. A first-record
index changes these lookups to expected `O(R + F)` time with `O(R)` extra space.
The first occurrence wins even when duplicate IDs make the input invalid, preserving
the previous scope diagnostics and their order. This index is separate from the
later collision check, which has different rules for skeleton/semantic IDs.

Each cube/plane also filtered all `S` surface bindings. Grouping bindings once per
lowering invocation changes that lookup work from `O(G × S)` to expected `O(S + G)`
for `G` textured primitives, using `O(S)` additional references. Groups retain all
duplicates so missing or multiply bound surfaces still fail with the same diagnostic.
Layout, atlas dimensions, material and concrete texture checks remain per primitive.
Both indexes are local to one invocation; there is no cross-build invalidation state.

Measured on 2026-09-14 using the same five-run median procedure, against the previous
parent-cycle improvement. The new cases time complete geometry lowering on prebuilt
IR: each cube has six explicit face children and a distinct surface binding/plan.
Source parsing and texture rasterization are outside this stage measurement. The
output comparison includes the full canonical geometry, transforms, faces and UVs.

| Geometry case | Previous median ms | New median ms | Speedup | Process peak RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| 100 cubes / 600 faces / 100 surfaces | 6.26 | 1.54 | 4.06× | 85.3 → 85.6 |
| 1,000 cubes / 6,000 faces / 1,000 surfaces | 513.76 | 13.64 | 37.67× | 123.1 → 119.9 |

All thirteen paired output hashes match; raw results for every case are in
[compiler-geometry.json](compiler-geometry.json). Small existing models show no
consistent whole-build speedup, and ordinary cases contain both timing improvements
and regressions. The measured benefit applies to large geometry/surface collections.
Tests cover first-occurrence duplicate parent diagnostics, missing/duplicate surface
bindings, existing plane material behavior, and a deterministic bound on binding
reads with many unrelated surfaces. The runner now includes thirteen cases; geometry
fixtures are defined in `scripts/corpus/geometry.js`.

## Indexed texture chart preparation

For `C` contract charts, `D` source chart declarations and `U` geometry usages,
preparation previously filtered all declarations and usages for each chart:
`O(C × (D + U))` lookup work. It now groups both lists by chart ID once per
invocation, for expected `O(C + D + U)` lookup work and `O(D + U)` retained
references. Each group retains original ordering and duplicates. The same second
declaration span is used for duplicate-chart errors, and usage mismatch reporting
retains its previous span even when a later usage is the first mismatching shape.
Unknown, missing and unused chart checks remain intact.

This does not make the whole materializer linear: pairwise chart overlap checking
still takes `O(C²)`, and sorting, pixel generation and encoding remain. Grouped
references replace repeated filter allocations, but peak process memory is not
materially reduced in the measured cases.

Measured on 2026-09-14 with Node 24.13.1/macOS arm64 and the same five-run median
procedure, against the completed geometry optimization. These cases time complete
texture plan materialization, including composition, rasterization, PNG encoding
and digesting, from prebuilt source AST and typed contracts. Each chart covers one
texel in a non-overlapping horizontal atlas. Output hashing covers the complete plan.

| Charts | Previous median ms | New median ms | Speedup | Process peak RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| 100 | 2.89 | 1.65 | 1.75× | 85.7 → 85.3 |
| 1,000 | 44.89 | 13.91 | 3.23× | 102.8 → 103.3 |

All fifteen paired output hashes match. Full results are in
[compiler-charts.json](compiler-charts.json); fixtures are in
`scripts/corpus/charts.js`. These stage measurements do not imply the same speedup
for whole builds or for atlases dominated by pixel work. Regression coverage checks
duplicate/missing declarations, unused charts, usage mismatch diagnostic spans,
and a deterministic linear bound on usage chart reads for 100 charts.

## Fast acceptance of non-overlapping atlases

For 32 or more charts, preparation now first detects overlap with an x-axis sweep
and a segment tree over compressed y coordinates. End events precede start events
at the same x, and y ranges are half-open, so touching edges remain valid. Each
rectangle contributes two events and each update takes `O(log C)` time. Valid,
non-overlapping atlases therefore finish overlap checking in `O(C log C)` time
with `O(C)` auxiliary space, instead of `O(C²)` comparisons and constant scratch
space. Small atlases keep the simpler pairwise check to avoid index overhead.

If any overlap exists, the original ordered pair traversal generates the detailed
diagnostics. This retains every error's order, count and source span, with the
previous `O(C²)` invalid-input bound plus the detection pass. No list of all
overlapping pairs is accumulated. The helper receives already validated positive,
finite atlas rectangles and does not replace dimension or bounds validation.

Measured on 2026-09-14 with the same host and five-run median procedure, against
the preceding chart-index optimization. These are complete texture materialization
times, including rasterization, PNG encoding and digesting, not timings of only the
overlap detector. All sixteen paired output hashes match; raw results are in
[compiler-overlap.json](compiler-overlap.json).

| Charts | Previous median ms | New median ms | Speedup | Process peak RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| 100 | 1.57 | 1.56 | 1.00× | 85.0 → 85.0 |
| 1,000 | 11.69 | 8.96 | 1.30× | 102.1 → 102.2 |
| 4,000 | 51.03 | 29.96 | 1.70× | 165.4 → 165.8 |

Peak memory does not improve; the detector deliberately trades linear indexing
space for fewer comparisons. Tests compare overlap existence with the original
predicate on 500 generated graphs of rectangles in both orders, cover edge/corner
contact, containment, crossing, horizontal/vertical layouts and a 4,096-chart grid,
and verify exact diagnostic order and spans for a 100-chart invalid atlas. The
benchmark now includes sixteen cases.

## Exact-number validation and integral normalization

The shared exact-number budget check previously converted accepted magnitudes to
binary strings merely to test whether they fit in 512 bits. It now compares the
original signed BigInts directly with the precomputed exclusive bounds `±2^512`.
This removes binary-string and absolute-value temporaries from validation and the
unused compiler-private bit-count helper. A `b`-bit accepted operand formerly needed
an `O(b)` temporary string; the range check creates no operand-sized JavaScript
temporary. BigInt comparison costs remain runtime-dependent, and the accepted
domain was already bounded to 512 bits, so this is chiefly an allocation and
constant-factor improvement rather than a whole-compiler asymptotic change.

After input, denominator and budget validation, exact numbers with denominator
`1` or `-1` now return their sign-normalized immutable record directly. They avoid
unnecessary remainder and division operations. Other rationals retain the existing
GCD reduction. There is no conversion to floating point, rounding or widened budget.

Measured on 2026-09-14 with the same host and five-run median procedure, against
the completed overlap optimization. All sixteen paired output hashes match. Full
results, including unchanged or slightly slower cases, are in
[compiler-numeric.json](compiler-numeric.json).

| Case | Previous median ms | New median ms | Speedup |
| --- | ---: | ---: | ---: |
| 24 model entries | 233.74 | 223.98 | 1.04× |
| 1,000 cubes geometry lowering | 13.07 | 12.37 | 1.06× |
| 1,000 charts materialization | 8.98 | 8.00 | 1.12× |
| 4,000 charts materialization | 32.02 | 24.87 | 1.29× |

The gains are smaller than the earlier quadratic-work removals, and peak process
RSS is essentially unchanged. Regression tests compare the budget predicate with
the old bit-length rule around every power of two through 514 bits, both signs and
both numerator/denominator positions. They also cover non-BigInt inputs, zero
denominators, oversized reducible fractions, integral sign normalization, ordinary
rational reduction and immutability.
