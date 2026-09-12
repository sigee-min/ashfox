---
name: ashfox
description: Create, refine, animate, and review voxel game assets as native .ashfox source with the Ashfox CLI. Use for model, texture, sound and game delivery work, not for changes to the Ashfox implementation.
---

# Ashfox

Create assets as code. The editable authority is the project's `.ashfox` files
and their imported modules. Use the CLI to inspect, capture, replay, compile and
export them. The website provides documentation and example previews.

Read https://ashfox.io/agent.md in full for the shared installation and documentation entry point. A skill is optional; users can start by pasting the landing page setup prompt into their existing coding agent.

## Start in the asset repository

1. Read the user's request and the existing source before changing anything.
   Preserve unrelated assets and the established silhouette, palette and pixel
   density unless the user asks to change them.
2. Check the installed CLI with `npx --no-install ashfox --version` and
   `npx --no-install ashfox doctor`. If unavailable, follow
   https://ashfox.io/docs/guides/install/ and explain the installation needed.
3. Read https://ashfox.io/docs/guides/agent-workflow/ and the relevant DSL reference
   before using unfamiliar language features. Use `ashfox --help` and
   `ashfox capabilities` for the installed command contract. Published examples
   may describe a newer CLI; check release notes when a feature is unavailable.
4. Follow the existing asset repository configuration. New projects use grouped
   sources under `asset/`, generated outputs under root `build/`, and Git ignores
   for generated files. See https://ashfox.io/docs/guides/repository-layout/.

## Create, observe, deliver

- Edit source files directly. Use an optional `.ashfoxworkspace` or
  `.ashfoxworkspace.mjs` to configure builds; keep a single configuration per root.
- For one asset, inspect identifiers, edit the source, capture useful angles and
  texture details, and replay each changed motion. Listen to sound variants.
  Successful compilation alone does not establish visual or audio quality.
- Use `ashfox stdio` for repeated operations on an asset in memory. Follow its
  revision contract when replacing the complete source graph.
- For game delivery, run check, build and verify against the configured workspace.
  Consume deterministic outputs through the game's adapter; do not hand-edit
  generated PNG, GLB, audio or runtime manifests.
- Save or export the files requested by the user. Report exact output locations,
  what was inspected, and any behavior still unverified in the receiving game.
  Do not claim successful output from a preflight check alone.

## Skill updates

The current user guides and installed CLI are sufficient for asset work. When a
skill update is relevant, `scripts/sync.py` checks availability without changing
files. Use `--install` only when the user requests a skill update, then reread
this file. The installer refuses repository checkouts; do not bypass its checks.
