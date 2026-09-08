# Authoring and review

Start with the requested outcome and the current asset. Preserve its block
silhouette, pixel density, palette, and focal marks unless the user asks to
change them. Share modules where reuse is useful; a small study can stay in
one source file. Keep each entry's assembly explicit.

## Choose source owners

| Declaration | Sole authority |
| --- | --- |
| `design` | exact shared dimensions, construction datums, and named checks |
| `rig contract` | semantic joint tree, signed frames, channels, mirrors, sockets |
| `skeleton` | complete concrete rest implementation of one rig |
| `surface contract` | exact atlas/chart/material/slot ABI |
| `surface` | concrete deterministic palette, chart paint, grain, stamps, and material |
| `component` | reusable lexical geometry plus typed rig/surface/socket ports |
| `motion` | rest-relative rotation/scale tracks for one nominal rig |
| `asset` | skeleton choice, component instances, bindings, connections, motions, settings |

An import is always an explicit quoted path plus alias. Nominal declaration
references are local or `alias.Name`; design values use `Design.field` or
`alias.Design.field`, with an optional vector axis. Matching names or similar
shapes do not create compatibility.

## Precision without changing the style

Use shared design values for linked geometry, rest origins, and chart sizes.
Checks reject invalid authored relationships; they do not move geometry or
solve constraints. Inspect current nodes, rest-pose dimensions, ground gap,
and face UV when those facts matter, then re-inspect after the source change.
Measurements cover full primitives, not visible alpha coverage or clearance
throughout animation. The [precision modeling guide](precision-modeling.md)
contains an executable resize example and the exact observation requests.

## Geometry before paint

- Use cubes for positive-volume masses, attachment, depth, and silhouette.
- Use a plane only for an intentionally zero-thickness feature whose edge-on
  disappearance is acceptable.
- Put hierarchy in lexical `bone` blocks. Bind component bones to semantic rig
  joints or exact socket frames; do not infer a nearby parent.
- State every origin, size, basis, frame, and surface chart binding.
- Keep geometry private to its component unless callers need a typed parameter
  or port. Do not expose arbitrary emitted nodes as an override surface.

## Deterministic surfaces

Define exact chart dimensions in the surface contract. A concrete surface owns
the texture atlas, palette roles, chart origins/fills, optional stamps and
blotch patterns, one seed-only clustered-grain pass, and optional voxel tone.

Share exact chart dimensions through design fields. Anchor focal stamps in
face-local pixels so resizing a face does not stretch the mark. Use explicit
protection margins where tone and grain must leave surrounding detail intact;
protection does not change alpha coverage or stop later stamps.

Texture variation is source-deterministic. The seed changes the exact bounded
microvariation; it is not runtime randomness. Texture cannot repair a missing
mass, weak silhouette, bad joint, or floating attachment. Conversely, geometry
must not duplicate a paint mark as a coplanar surface.

## Reuse without inheritance

Components use closed typed parameters and nominal ports. Calls bind every
parameter and port once by name. Socket contracts make an attachment ABI
explicit, including handedness, frame, and capacity. Motion targets semantic
rig joints, so the same motion can be applied to any skeleton implementing the
same nominal rig with compatible signed frames.

There are no classes, inheritance, mixins, structural subtyping, default
arguments, wildcard imports, runtime packages, or automatic retargeting. If
two concepts differ in contract, model that difference explicitly rather than
adding an override chain.

## Review order

1. Inspect the smallest gameplay view for silhouette and facing.
2. Check front, side, top, and perspective for hierarchy, contact, clipping,
   negative space, and connected volume.
3. Check native texels, palette grouping, chart boundaries, alpha, and focal
   stamps.
4. Scrub every motion and inspect pivots, signed-frame mapping, loops, and
   target-export findings.
5. Use Build replay to confirm deterministic element and texture application.

Compiler success proves language, closure, and canonical invariants. It cannot
certify taste. A review issue belongs to the owning module and is resolved by
one new atomic workspace change.

For declaration syntax and ownership, see
[Asset language](../architecture/asset-language.md).
