# Save and export

Ashfox saves the complete `.ashfoxworkspace` authority, not a compiled scene.
The portable file contains canonical JSON with exact source modules, package
manifests, and the content-addressed lock, followed by exactly one LF.

## Save and reopen

Use **Download workspace** to save the active workspace. Opening it validates
the closed container, selects an explicit package entry, recompiles the exact
entry closure, and creates a transient `AssetProject`. It never restores or
trusts cached geometry, textures, animation channels, previews, reviews, or
exports.

Opening requires the exact-current compiler lock, not just an unchanged
`ashfox-model 1` header. Older locks are rejected without automatic migration;
keep the original file before any explicit adaptation to a newer compiler.

An agent edit uses one `workspace.apply` operation containing:

- the current expected workspace hash;
- all file writes and deletes in the change;
- a full manifest replacement when package configuration changes;
- the package and entry to open after the atomic commit.

Every declared entry must compile. Failure or a stale hash commits nothing.
The engine regenerates local lock records and dependency pins. Caller-supplied
`changes.lock` and edits to embedded CAS packages are rejected. This resealing
does not weaken validation of a saved file on opening.

## Capture Build replay

After current revision-bound reviews are accepted, Build replay starts from an
empty scene, places concrete nodes in deterministic order, applies each node's
complete owning texture set atomically, activates the selected canonical
motion, and holds on the finished product.

Replay is transient evidence. It is not source history, an agent decision log,
or a portable project format.

## Export

Open **Export delivery files**, choose Java block, GeckoLib 5, Bedrock, GLB, or
glTF, and provide a namespace/path only when the adapter requires it.

Export snapshots the active `AssetProject`, recompiles its exact workspace and
entry, verifies workspace hash, closure hash, build key, compiler fingerprint,
and product hash, then runs target validation. An artifact cannot be built from
a swapped workspace, entry, build identity, or canonical document.

The current target version is read-only and comes from the engine registry.
Target adaptation may describe an explicit conversion or omission in its
receipt; it cannot rewrite the workspace or silently lose data.

See [Choose an export format](choose-a-format.md) for target-specific files.
