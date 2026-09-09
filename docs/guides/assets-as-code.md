# Assets as Code

Assets as Code means keeping the editable definition of an asset in source,
reviewing its changes in version control, and compiling the outputs you deliver.
Ashfox brings this workflow to voxel games: models, pixel textures and procedural
sounds share native `.ashfox` source and one CLI.

Git records the source history. Ashfox compiles and inspects the assets. Your CI
and game build decide when to run it and where to deliver the resulting files.

## Start with one asset

Follow [installation and your first PNG](install.md). Keep the source and its
imported modules in your game repository. A single asset needs no workspace;
add an optional `.ashfoxworkspace` when you need shared selection or delivery
settings. See [project configuration](workspace.md).

Move from an item to a creature with the source-backed examples on
[the homepage](https://ashfox.io/#frontier). The Griffin demonstrates articulated
wings and six motions; the fox and goblin provide smaller animated examples.
Inspect the source and the exported model together. Build replays reconstruct
finished assets; they are not recordings of an agent's editing process.

## Keep source and outputs distinct

| Keep in Git | Keep with the build or release |
| --- | --- |
| `.ashfox` entries and every imported source module | Exported GLB, PNG, WAV, OGG and ZIP files |
| Optional `.ashfoxworkspace` and its delivery configuration | Build receipts, catalog and exact returned output paths |
| `package.json` and `package-lock.json` pinning the CLI | Source commit, compiler version and execution profile |
| CI scripts and game integration code | Review captures and motion previews tied to that source commit |

Ignore generated directories according to your actual configuration. Do not
ignore every PNG or WAV globally: your game may also contain hand-authored files.
Generated exports are not a second editing surface. Make the change in source
and rebuild. Publishing generated examples in documentation is a separate,
deliberate distribution choice.

## Make one reviewable change

1. Create a Git branch. Ask your agent for a bounded change: a wing motion,
   an item palette or one impact sound. Include the intended game target.
2. Inspect the entry and imports before editing. Preserve unrelated assets.
3. Run the CLI checks. Capture useful model views, inspect textures at native
   resolution, replay changed motions, and listen to sound changes.
4. Commit the source and attach evidence to the pull request. Identify the
   source commit, affected asset IDs, toolchain and any untested game behavior.
5. Review both the text diff and the output. A compiler pass establishes
   technical validity; it does not establish visual quality or game fit.
6. After merging, build the merged source in a clean, pinned environment. Verify
   the result and pass the returned immutable output directory to the game build.

Refresh review evidence after a source change. Avoid representing captures from
an earlier commit as the result of the current PR. An accepted preview of a
branch is not proof that a later merged build is identical.

[Work with an agent](agent-workflow.md) explains the editing loop.
[Inspect and capture](observe.md) covers views, pixels, motion and stdio.

## Add CI when the local loop works

Start with the scripts in [build automation](automation.md). Use `npm ci` to
restore the pinned package and run check, build and verify before the game build.
Treat any nonzero exit code as a failed asset build. Consume the exact paths
returned by the successful build rather than a stale export from a previous run.

Pin the CLI and the execution environment, including Node, OS/architecture and
FFmpeg when producing OGG. Reproducibility is scoped to the same toolchain and
execution profile; byte equality across arbitrary machines is not promised.
Give concurrent jobs separate output directories.

PR jobs should validate and produce review artifacts with read-only permissions.
Keep release credentials out of untrusted pull-request execution. Upload captures
and build evidence as CI artifacts, then publish game deliveries from a separate
trusted job. Ashfox does not install a PR bot, create Git commits, continuously
reconcile a remote system, or automatically deploy your game.

## Release and restore deliberately

Associate each delivery with its source commit and build identity. Retain the
verified package used by the receiving game. For a rollback, either select that
retained package or restore the earlier source and its matching toolchain, then
build and verify again. Reverting source alone does not change an already
released game.

For receiving-game checks, verify scale, orientation, animation names, item IDs
and sound-event mappings. See [game bundles](game-assets.md),
[Minecraft packs](minecraft-packs.md) and the [playable example](web-game.md).

## Practices behind this workflow

The write, preview and review loop follows the collaboration pattern described
in [OpenTofu's core workflow](https://opentofu.org/docs/intro/core-workflow/).
The separation of review-time checks and delivery follows
[Pulumi's continuous delivery guidance](https://www.pulumi.com/docs/iac/operations/continuous-delivery/).
For CI permissions and untrusted changes, follow
[GitHub's secure use reference](https://docs.github.com/en/actions/reference/security/secure-use).
These are inspirations for operating Ashfox, not integrations installed by it.
