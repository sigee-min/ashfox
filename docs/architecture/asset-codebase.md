# Asset codebase

Ashfox v1 is a hermetic, statically typed asset language. A workspace may
contain several independently buildable assets and shared source modules. The
compiler resolves and checks source declarations, instantiates one selected
entry, and erases every authoring-only type before producing the concrete
runtime asset.

The language header remains exactly `ashfox-model 1`. There is no compatibility
reader, implicit include, or second grammar version.

## Authority boundaries

There are four distinct build identities, separate from the host revision.

- The workspace hash protects atomic multi-file edits.
- The entry closure hash identifies the exact transitive source and locked
  dependencies used to build one asset.
- The build key binds that closure to the compiler and policy fingerprints.
- The product hash identifies the concrete scene, textures, and animations.

Changing an unrelated entry may leave another entry's closure and product hash
unchanged, but it creates a new workspace head and invalidates accepted review
evidence. Changing any reachable module byte,
dependency digest, compiler policy, instantiation argument, surface policy, or
animation bake policy changes the entry build identity.

The compiler receives a closed in-memory workspace. It never resolves a host
path, symlink, URL, package registry, or mutable version range. Logical paths,
manifest data, and lock data are validated before parsing source files.

The only portable container is `.ashfoxworkspace` with media type
`application/vnd.ashfox.workspace+json`. Its bytes are canonical JSON followed
by exactly one LF. The container stores only the workspace source authority;
it never embeds a compiled scene, preview, cache, review receipt, or export.

The host may keep a transient `AssetProject` that joins its own identity and
revision to one workspace head, one explicit selected entry, one build
identity, and one derived `ProjectDocument`. That document exists only as the
validated runtime/export projection and is never serialized back into the
workspace.

## Language concepts

Ashfox uses domain declarations instead of classes or inheritance.

### Design

A design owns typed exact values and named boolean checks. It can connect
geometry dimensions, skeleton origins, chart sizes, and motion values without
duplicating coordinates. Exported fields cross explicit imports; dependencies
must be acyclic. Evaluation substitutes exact values before Typed HIR and
does not retain solver state, create bones, or fit geometry. See the
[executable precision guide](../guides/precision-modeling.md).

### Rig

A rig is a nominal motion ABI. It declares one semantic root, the required
joint tree, handedness, joint-local signed frames, allowed transform
channels, mirror pairs, and typed sockets. Joint names or matching hierarchy do
not create compatibility. The rig's module-qualified identity does.

Required joints and sockets are unconditional literal declarations. They
cannot depend on conditional expansion, generated names, optional components,
or runtime state.

### Skeleton

A skeleton implements exactly one rig. It binds every required semantic joint
to one concrete bone and supplies its rest origin and orthonormal local frame.
Extra skeleton binds are rejected. Private lexical geometry bones belong to
components, not to additional undeclared skeleton joints.

### Component

A component owns reusable geometry. It declares typed rig, socket, and surface
ports. It cannot capture caller names or global resources. Components connect
through exact socket frames or semantic rig joints; they do not search for a
nearby attachment or infer orientation.

One component has one placement authority. A rig-bound component maps its
semantic attachment scopes to the selected skeleton. A socket-anchored
component has exactly one required socket. It cannot combine both models or
declare several placement inputs. Provided sockets expose downstream anchors;
they do not move their owner. Connection placement composes the provider world
frame with the inverse required-local frame, so endpoint frames are explicit
transforms rather than values that must be numerically equal.

Socket frames stay exact by construction. A rig-bound component may expose
sockets only from geometry bones mapped to semantic joints. A socket-anchored
component binds every socket to its one placement-anchor bone. Arbitrary
private animated bones cannot become connection authorities; doing so would
make assembly order depend on a floating-point transform bake.

### Surface

A surface contract declares named appearance slots together with chart layout,
dimensions, coverage, and material requirements. Geometry owns its
chart topology. A concrete surface owns pixel appearance. Instantiation binds
them into one typed surface handle, so a texture owner and an unrelated chart
can never be paired.

The concrete surface owns each chart's explicit atlas `origin`; an asset
entry selects and binds that surface. Shared design fields can calculate
origins, but there is no automatic atlas packing or target-specific fork.

The current language requires exactly `density = 16`: one model unit occupies
one chart texel. `texels(length, factor)` is an explicit exact conversion, not
an alternative asset-density setting. A flat chart's ABI
dimensions equal its plane dimensions. A box with integer size `(x, y, z)`
requires the explicit canonical net `(2x + 2z, y + z)`. Reusing one chart is
valid only when every bound primitive has exactly the same dimensions. No
compiler phase invents, scales, or packs UVs.

### Motion

A reusable motion is nominally bound to one rig and addresses semantic joints,
not scene node strings. Rotation and scale keys are rest-relative. The compiler
transforms them through signed joint frames using matrix or quaternion math and
then deterministically bakes concrete entry channels.

Position tracks, inferred entity root motion, end-effector goals, IK, and foot
locking are not supported. Bone-name matching and automatic length scaling
are forbidden.

The instantiator maps every rotation or scale vector from the rig joint's
signed semantic basis into the selected skeleton bind basis before canonical
channels exist. This mapping is an exact signed-axis permutation; exporters
never retarget or reinterpret motion.

Applying motion across different nominal rigs is rejected in v1. A future
retarget feature would have to map every used joint and signed frame
explicitly; semantic roles could inform diagnostics but could never become
matching authority. No partial name-based retarget surface exists today.

### Asset

An asset is a concrete entry. It chooses a skeleton, surfaces, components,
socket connections, and motions. Every parameter and port binding is explicit;
there is no variant declaration or arbitrary emitted-node override.

## Compiler architecture

~~~text
closed workspace + lock
  -> path and package graph validation
  -> parse and nominal name resolution
  -> bounded exact design evaluation and named checks
  -> immutable Typed HIR
  -> immutable Instantiated Asset IR
  -> rig binding, surface binding, frame mapping, and deterministic bake
  -> concrete scene, textures, and animations
  -> independent canonical and target validation
~~~

Typed HIR contains resolved symbols, exact typed values, module-aware source
references, and rig/component/surface/socket ABIs. Instantiated Asset IR
contains only concrete instances, bindings, rewritten motion, and one shared
budget ledger. Both forms are compiler-private and immutable.

There is no runtime VM, persisted HIR, bytecode, optimizer IR, or editable
canonical graph. Runtime products contain concrete per-entry data. A package
artifact may deduplicate identical product blobs by digest without preserving
source-level module or rig objects.

## Packages and builds

A workspace manifest lists local packages and asset entries. Each package
manifest lists source roots and exported entries. The generated lock identifies
every dependency by exact content digest and interface digest. The build host
may fetch a locked package into a local content-addressed store before invoking
the compiler, but compilation itself performs no I/O.

Module symbol identity is composed from a nominal package instance, normalized
full logical path, declaration kind, and exported name. A workspace package's
nominal instance is its unique package name, so unrelated local edits do not
silently create a new type universe. A CAS dependency's nominal instance is
its exact locked digest. Import aliases and source-unit display names never
participate in symbol identity or canonical output.
Cycles, wildcard imports, re-exports, mixed dependency digests, implicit index
resolution, and entry-to-entry imports are rejected.

Selected-entry resolution parses only the selected root and its transitive
imports. An unrelated malformed entry or unused module cannot change or block
that build. Whole-workspace validation is a separate commit gate and checks
every declared source before an atomic change becomes authoritative.

Workspace resolution produces one compiler-private, immutable entry closure.
Every reachable source appears once with its parsed source unit and already
resolved package-qualified import edges. Design elaboration and Typed HIR consume that sealed closure
and never parses import specifiers or consults the workspace again. This keeps
the graph, type checker, cache identity, and diagnostic ownership on one
resolution authority.

Exported interface digests are conservative hashes of normalized exported
declarations produced by the canonical parser. They may change for a private
body edit; this deliberately favors safe invalidation over a falsely precise
ABI promise. Import aliases and source-unit display names are not nominal
symbol identity.

Workspace edits use one expected workspace hash and one atomic change set. The
engine derives local lock records from the candidate sources and manifest;
`changes.lock` is a rejected legacy input. CAS records and source bytes remain
immutable, and no dependency fetching is added to editing. Saved-file opening
continues to validate its exact lock independently of this resealing step.
The candidate graph and every declared entry are validated and compiled before the
branch head advances. Failure commits neither source nor products. Per-file
CAS is not an authority.

Every module declared by a package manifest must be reachable from at least
one declared asset entry. The atomic workspace gate parses every declared
source, validates every entry, compiles every entry, and rejects an orphan
module. This keeps reusable libraries source-visible without creating a pool
of semantically unchecked code beside the build graph.

The host surface includes workspace read/write, atomic workspace change,
selected-entry compile, and read-only product measurements. Parser AST, resolved closures, Typed HIR, instantiated
plans, source maps, cache records, and package registries are not root exports.
Selected-entry compile has one closed result: success contains only `ok`, the
concrete model, and its workspace/closure/build identity; failure contains only
`ok` and module-aware diagnostics. A successful compile never exposes a
partially typed graph or recoverable intermediate representation.

## Diagnostics and budgets

Every source-owned diagnostic has a package, logical path, and file-local span.
The compiler reports the owning import, declaration, binding, or assembly site
where available; canonical whole-product failures can use the entry-root span.
Diagnostic ordering includes the logical source path.

Workspace file/package/entry/module counts, path and source size, import depth
and edges, parser declarations, semantic tree nodes, motion frames, and
diagnostics have explicit finite ceilings. A failed or exhausted phase returns
no partial product.

## Deliberate exclusions

Ashfox v1 does not include classes, inheritance, mixins, structural subtyping,
general generics, overload resolution, runtime imports, mutable registries,
automatic bone matching, automatic retargeting, geometry fitting, collision
solvers, automatic socket selection, semantic design inference, editable
derived state, or target-specific source branches.

Composition, nominal contracts, exact values, explicit adapters, and atomic
builds are the complete reuse model.
