# Agent workflow: source edits without hand-written locks

This is the execution guide for runtime manifest schema version 2. Connect to
`https://ashfox.io/workbench/` by default and fetch its
`agent-manifest.json` through direct HTTP. When the user explicitly selects a
development Workbench, use that origin's manifest and linked reference files.
Do not navigate the working browser away from the app to read documentation.

The API below runs in the connected Workbench page as `window.ashfox`.
The browser-control tool must support that page API. Do not access private
application state, IndexedDB, or rendered DOM to recover source or bypass it.

## Ownership and the hard cut

- The agent authors `.ashfox` source and, when needed, package configuration
  through a full workspace `manifest` replacement.
- The engine deterministically regenerates local package content, file,
  manifest, and exported-interface hashes and local dependency pins.
- Embedded content-addressed (`cas`) packages retain their exact bytes and
  pins. Editing, replacing, or installing external packages is not supported
  through the workspace edit command.
- `changes.lock` is rejected even when the supplied lock looks correct.
  There is no fallback to the former caller-authored lock workflow.
- Persisted `.ashfoxworkspace` files still include the exact lock and are
  strictly validated on opening. Automatic resealing applies to valid current
  workspace edits, not to importing stale or tampered files.

This changes the editing contract, not the `ashfox-model 1` language header or
the precision compiler fingerprint. Existing valid saved products do not need
a migration, and no alternate authoring path is added.

## 1. Inspect identity and discover source

Call `ashfox.inspect()` and require `ok === true`. Its `data` provides the
selected `entry`, `workspaceHash`, `revision`, and `build.buildKey`. A read-only
user task stops after gathering and explaining relevant evidence.

Discover files rather than guessing paths:

```javascript
ashfox.inspect({
  kind: 'workspace',
  catalog: { expectedWorkspaceHash, offset: 0, limit: 32 }
});
```

`data.catalog.files` rows identify source path, content hash, code-unit length, owning
package, declaration kind, and whether the package is local or CAS. Follow
`data.catalog.nextOffset` until it is null; lower `limit` if the response is too large.

Read current configuration in chunks when planning package changes:

```javascript
ashfox.inspect({
  kind: 'workspace',
  document: {
    expectedWorkspaceHash, document: 'manifest', offset: 0, maxCodeUnits: 2048
  }
});
```

Use `document: 'lock'` for dependency evidence only, never as an edit payload.
Read `data.documentChunk`. Concatenate `content` chunks in order and parse the complete JSON only after
`done` is true. Advance offsets by the returned content's JavaScript `.length`
(UTF-16 code units), not byte count. Restart the read if its guard becomes stale.

Read source using one known path:

```javascript
ashfox.inspect({
  kind: 'workspace',
  read: { expectedWorkspaceHash, path, offset: 0, maxCodeUnits: 2048 }
});
```

Use exactly one of `catalog`, `document`, `read`, or `candidate` in a workspace
inspection request. Source reads return `data.sourceChunk`; metadata reads
return `data.documentChunk`. Both carry the exact workspace hash and offsets.
These operations are read-only. Source and metadata chunk limits are
1–2048 code units; catalog page limits are 1–32 records.

## 2. Choose the source owner

Use the [language guide](../architecture/asset-language.md) for declaration
syntax and the [precision guide](precision-modeling.md) for a complete model.
Do not invent missing binding, atlas, or motion syntax from prose summaries.

For an existing model, discover canonical node IDs and inspect relevant
geometry and face UV with the current revision/workspace/build guards. Keep
silhouette, palette, fixed-size focal stamps, and pixel density unless the
user explicitly changes them. Measurements describe full primitives in the
rest pose; they cannot certify visible contact or motion clearance.

Choose a design field for shared dimensions, a component for geometry, or a
surface for pixel detail. Replacing one source file does not require copying
the whole workspace. Adding or removing a declared file requires a complete
updated manifest in the same change set. All declared modules must remain
reachable from at least one entry.

## 3. Stage and inspect the candidate

Fetch the current `workspace.apply` command schema before constructing an
unfamiliar write. The minimal edit shape is:

```javascript
const changes = {
  expectedWorkspaceHash,
  writes: [{ path, source: revisedSource }],
  deletes: []
};
const preview = ashfox.inspect({
  kind: 'workspace', candidate: { entry, changes }
});
```

`entry` is an explicit `{ packageName, entryName }` selector. `source` is the
complete replacement file, not a patch. Optional per-file `expectedHash`
guards supplement—but do not replace—the workspace hash. Include `manifest`
only for a full configuration replacement; do not include `lock`.

Two checks are required: `preview.ok` means the inspection request succeeded;
`preview.data.valid` means the candidate passed workspace and semantic checks.
A valid response supplies `preview.data.previewToken`. An invalid candidate
returns diagnostics and no usable token, without changing the active project.

Present the token with `await ashfox.present({review:'preview',previewToken})`
and inspect the rendered result. A preview is not an accepted delivery review.
If it is wrong, revise source and stage again. Do not apply a candidate merely
because it compiled.

## 4. Apply exactly the inspected edit

After inspecting the candidate, submit the same `entry` and `changes`:

```javascript
const result = await ashfox.run({
  requestId: 'a-unique-id-for-this-logical-edit',
  operations: [{ name: 'workspace.apply', payload: { entry, changes } }]
});
```

Use a unique request ID for a new logical edit. Submit exactly one operation.
The engine reseals local records and validates every declared entry before one
atomic commit. A failed entry, orphan module, stale guard, invalid source, or
CAS modification leaves the current workspace untouched. The preview token
is not a mutation authority and is not supplied to `run`.

On failure, inspect the result and fresh state before deciding whether to
revise or retry. Do not blindly resubmit, loosen a check, or alter derived
geometry. Metadata visible through inspection is evidence, not permission to
modify external dependencies.

## 5. Verify and review

After success, obtain a fresh overview, discover current node IDs, and repeat
affected measurements and UV reads. Old guards and review evidence are stale.

Follow `present({review:'next'})` through the required frames and motion
cycles. Observe each actual rendered result before accepting its returned
`frameNonce` and check IDs. A rejected review requires a new source revision.
After accepted reviews, generate Build replay; preflight the user's selected
export target when delivery is requested, then let the user export. Preflight
is not an exported artifact, and measurements are not visual approval.

## Failure routing

| Failure | Next action |
| --- | --- |
| Stale read or write | Refresh identity and reread/restage affected source. |
| Unknown `lock` field | Remove the retired edit field; the engine owns local resealing. |
| Invalid candidate | Read diagnostics even when the inspection envelope is successful. |
| Source/metadata response too large | Lower chunk size; concatenate before parsing. |
| Catalog response too large | Lower page size and follow `nextOffset`. |
| CAS mutation or package conflict | Keep the external package immutable; use an explicit local design instead. |
| Persisted file has invalid lock | Preserve the original file; do not treat edit resealing as a repair reader. |
| Rendering unavailable | Report the missing evidence; never accept an unseen review. |
