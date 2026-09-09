# Model Workbench API

This reference is for agents controlling the model Workbench. It is separate
from the native CLI project pipeline: a browser project download is not a root
`.ashfoxworkspace` configuration. For source files and automated game builds, use
[the CLI agent workflow](agent-workflow.md). The model Workbench does not open
directory projects or build sprite/sound packs.
Connect to
`https://ashfox.io/workbench/` by default and fetch its
`agent-manifest.json` through direct HTTP. When the user explicitly selects a
development Workbench, use that origin's manifest and linked reference files.
Do not navigate the working browser away from the app to read documentation.

The API below runs in the connected Workbench page as `window.ashfox`.
Use that page API when the browser-control tool can evaluate page JavaScript. If
it cannot, use the transport-only DOM bridge described below. Do not access
private application state, IndexedDB, or rendered DOM to recover source or
bypass it.

## Transport fallback for restricted browser tools

The Workbench exposes one hidden input and one result meta element for tools
that can fill a browser locator and read an attribute but cannot evaluate page
JavaScript:

- input: `[data-agent-command-port-input]`
- result: `meta[data-agent-command-port-result]`, whose
  `data-agent-command-port-result` attribute is JSON

Send one outer envelope at a time:

```javascript
{
  requestId: 'agent-unique-id',
  method: 'inspect' | 'run' | 'present' | 'capture',
  payload: methodPayload
}
```

For `run`, `payload` contains `operations` only. The bridge uses the outer
`requestId` as the run request ID, so do not put another `requestId` inside
that payload. The result attribute contains `{requestId, result}`. Wait for a
result with the matching outer ID; an older result must not satisfy a new
request. Locator `fill` emits the input event that submits the request. The
bridge removes the input after that event and appends a replacement, so
reacquire the locator before every call and keep requests sequential.

This is the complete locator-based shape, with a bounded wait:

```javascript
async function callAgent(browser, method, payload, timeoutMs = 600000) {
  const requestId = 'agent-' + crypto.randomUUID();
  const input = browser.locator('[data-agent-command-port-input]').first();
  await input.fill(JSON.stringify({ requestId, method, payload }));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const serialized = await browser
      .locator('meta[data-agent-command-port-result]')
      .getAttribute('data-agent-command-port-result');
    if (serialized) {
      const envelope = JSON.parse(serialized);
      if (envelope.requestId === requestId) return envelope.result;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for the matching Ashfox response.');
}

const overview = await callAgent(browser, 'inspect', undefined);
const result = await callAgent(browser, 'run', {
  operations: [{ name: 'workspace.apply', payload: { entry, changes } }]
});
```

The two transport selectors are the only DOM exception. Do not use any other
DOM, canvas, source, IndexedDB, or browser-storage read to recover state or
author an asset.

## Edit contract

Author source and, when needed, replace the full workspace manifest. The engine
regenerates local lock hashes and pins; `changes.lock` is rejected. Embedded
CAS packages are immutable. Saved workspace files still require valid locks
when opened; the edit command cannot repair an incompatible saved file.

## 1. Inspect identity and discover source

Call `ashfox.inspect()` and require `ok === true`. Its `data` provides the
selected `entry`, `workspaceHash`, `revision`, and `build.buildKey`. The
overview's `data.workflow` provides `stage`, `remainingVisualReviews`,
`remainingVisualReviewCount`, and `visualReviewsTruncated`; `data.blocker` and
`data.nextActions` remain the actionable blocker and next-step guidance. The
review-key list is bounded; use the count and flag when deciding whether more
`present({review:'next'})` calls remain. A read-only user task stops after
gathering and explaining relevant evidence.

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

Use the [language guide](../language/model.md) for declaration
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
Candidate inspection does not switch the viewport. The bounded session cache
retains tokens against their exact base build; a changed base or cache eviction
requires staging again.

Present the token with `await ashfox.present({review:'preview',previewToken})`
and inspect the rendered result. A preview is not an accepted delivery review.
If it is wrong, revise source and stage again. Do not apply a candidate merely
because it compiled.
Every subsequent delivery presentation explicitly selects the current canonical
document and waits for evidence rendered from that exact document.

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

Follow `present({review:'next'})` through perspective, native, front, left,
right, top, and every motion cycle. Left and right are relative to the asset's
forward direction and each needs its own rendered evidence; `side` is rejected.
Compare paired focal marks in both side views, allowing intentional asymmetry
when the task calls for it. Observe each actual rendered result before accepting its returned
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
