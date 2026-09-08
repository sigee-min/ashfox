# Troubleshooting

## A workspace change is rejected

- Re-inspect the current workspace hash. `workspace.apply` rejects a stale
  compare-and-swap guard.
- Treat the first diagnostic's package, path, and span as the owning source
  location; do not patch the canonical scene.
- Make the package manifest list every entry/module. The engine regenerates
  local locks during edits; remove any retired `changes.lock` field. Embedded
  CAS bytes and pins are immutable. Saved-file locks are still checked strictly.
- Use explicit imports. Host paths, URLs, wildcard imports, implicit index
  files, mutable versions, import cycles, and entry-to-entry imports reject.
- Ensure every declared module is reachable from at least one declared entry.
  Whole-workspace commit does not retain orphan source.
- Compile every declared entry. One invalid entry rejects the entire staged
  change even if another selected entry would build.

## A symbol or binding is rejected

- Export a declaration before importing it from another module.
- Use the required `alias.Name` nominal reference; matching strings and shapes
  are not compatibility.
- Make each skeleton implement its exact rig and bind every required joint.
- Bind every component parameter and rig/surface/socket port exactly once.
- Connect sockets only when contracts, handed frames, and capacities are
  compatible.
- Apply a motion only to the nominal rig for which it was declared.

## Design values or pixel anchors are rejected

- Use `Design.field` locally or `alias.Design.field` for imported exported
  values. A vector axis follows the field, not the design namespace.
- Remove duplicate members and dependency cycles; keep declared units exact.
- A failed named check rejects the candidate. Correct its inputs or the
  intended relationship; it is not a solver that moves geometry automatically.
- `texels` must return an integral pixel value. Do not round away an error.
- A stamp uses either `at`, or `anchor` with explicit signed `offset`.
  A centered stamp with an odd leftover pixel count is off-grid; choose an
  appropriate anchor or change the authored dimensions.
- Keep the full stamp rectangle and any `protect` margin inside its face.
  Protection affects tone/grain, not alpha coverage or later explicit stamps.

See [Precision modeling](precision-modeling.md) for executable examples.

## An observation is stale or too large

Refresh the overview and obtain revision, workspace hash, and build key from
that same observation. All three guards must match for node, measurement, and
surface reads. Node IDs must come from the current guarded inventory.
For an oversized node response, lower `limit` and follow `nextOffset`; for a
source read, lower `maxCodeUnits` and follow the returned chunk boundaries.
A rejected read does not mean the model is empty.

Rest-pose bounds include complete hidden and alpha-cutout primitives. Ground
gap is not proof of visible contact, pairwise collision, or animation clearance.

## Texture or geometry is rejected

- Match every consumed primitive to the surface contract's chart layout and
  exact dimensions.
- Keep a chart and its concrete texture under the same surface contract.
- Use lexical bones and explicit rig/socket binding; arbitrary scene-parent
  escape hatches are not source authority.
- Keep plane geometry for genuine zero-thickness features. Rebuild masses and
  contacts as connected volume instead of coplanar overlays.
- Fix palette, chart, coverage, stamp, pattern, or grain diagnostics in the
  owning surface module. There is no automatic UV or paint repair.

## The product is valid but looks wrong

This is a visual review issue. Inspect gameplay/native, front, side, top, and
perspective views, then motion cycles. Revise the owning rig, component,
surface, motion, or asset assembly and submit a new complete workspace change.

Mechanical success proves deterministic closure, typing, lowering, and
canonical validity. It does not certify silhouette, proportion, focal detail,
palette quality, or taste.

## Export is rejected

Run the on-demand target preflight and read its target-specific findings.
Export request options are transient and cannot change the workspace. A
stale/swapped build identity, unsupported target feature, or unapproved data
loss must reject rather than silently flatten the artifact.

## Recover work

Reopen a current-contract `.ashfoxworkspace`. The reader validates canonical JSON and
the exact lock, then recompiles the selected entry. An older compiler lock is
rejected even when the source header is still `ashfox-model 1`; no automatic
migration or compatibility reader runs. Preserve the original file and use
an explicit reviewed source/lock update if adapting it to the current compiler.
Browser caches, derived
documents, previews, replay frames, reviews, and export receipts are
discardable products, not recovery authority.
