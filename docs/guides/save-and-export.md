# Save source and deliver a build

Keep the `.ashfox` files, every imported module and optional `.ashfoxworkspace`
together in version control. Those are the files you edit. Generated GLB, PNG,
WAV, OGG and ZIP files can be rebuilt and do not replace source backups.

## Export one asset

From the extracted starter folder:

```sh
npx --no-install ashfox export fox.ashfox --output fox.glb
npx --no-install ashfox export sword.ashfox --output sword.png
npx --no-install ashfox export claw_hit.ashfox --output claw.wav
```

Without `--output`, the bytes go to stdout for another process to consume.
Existing output files are refused; choose a new path or remove the previous
generated file deliberately. For camera images and GIFs, use
[capture and replay](observe.md). No workspace is needed for these commands.

## Select project output files

Use `exports` for individual files and `packs` for a game-ready file layout.
Follow [Project configuration](workspace.md) to select paths and IDs, then run
`build`. Source changes do not automatically rebuild existing output.

For engine delivery, find your pack ID in `result.exports`. Copy its `game-assets`
folder or ZIP. For Minecraft, copy the `resource-pack` folder or ZIP. Do not copy
the entire configured destination: it also contains versioned builds and
ownership metadata. See [Output formats](choose-a-format.md).

## Select exactly one build

The configured build directory contains `current.json`, which points to one
complete `bundles/<hash>` directory. Read that pointer once per consuming game
build, or use the `bundleHash` and paths returned by a successful `build` call.
Never choose a bundle by modification time or mix files from two hashes.

```sh
npx --no-install ashfox verify dist/build --json
```

Verification checks canonical file hashes, metadata and exact file coverage.
Runtime manifests in general game packs must match the files they reference.
It does not recompile source or certify visual/audio quality.

## Failed builds and cleanup

A failed pack, stale source, cancellation or encoding failure does not replace
the previous pointer. Unselected completed bundles can remain after a failure;
their presence does not mean publication succeeded.

No automatic cleanup runs. Remove old generated bundles only when no consuming
build uses them. Keep the selected bundle and its corresponding export copies.
For a fresh build, choose new empty output directories or remove only a known,
disposable generated output tree. Do not delete source or manually edit receipts.

The CLI refuses to take ownership of a nonempty unknown directory. Export mirrors
are verified during publication; `verify` checks the canonical build. If a delivery
copy was later modified, copy it again from verified canonical output or compare
its files against the catalog's hashes.
