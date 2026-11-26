---
name: ashfox
description: Create, refine, animate, and review voxel game assets as native .ashfox source with the Ashfox CLI. Use for model, texture, sound and game delivery work, not for changes to the Ashfox implementation.
---

# Ashfox

Create assets as code. The editable authority is the project's `.ashfox` files
and their imported modules. Use the 5 CLI verbs (`init`, `doctor`, `check`,
`render`, `build`) to initialize, inspect runtime readiness, validate/audit,
render views, and build declared targets.
The website provides documentation and example previews.

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
   `ashfox doctor --json` for the installed command contract. Published examples
   may describe a newer CLI; check release notes when a feature is unavailable.
4. Follow the canonical project layout: sources under `assets/{models,sprites,sounds,structures,module}/`
   (shared modules imported by 2+ entries live under `assets/module/`), generated
   outputs under root `build/`, and Git ignores for generated files. See
   https://ashfox.io/docs/guides/repository-layout/.

## Create, observe, deliver

- Edit source files directly. Declare build targets (`outputs { ... }`) and named
  inspection views (`preview [name] { ... }`) directly inside `.ashfox` entries; use an
  optional `.ashfoxworkspace` or `.ashfoxworkspace.mjs` for multi-asset/pack policy.
- For models, set `settings.profile = creature | prop | block` explicitly. Use
  Hytale / modern Blockbench craft instead of bare boxes and flat 1-line `fill`
  coats: decompose organic limbs with tapered `15°`/`22.5°`/`45°` joints and thin
  `plane` silhouettes (`ears`, `tufts`, `fins`, `plumes`) on `creature`/`prop` assets, keep `block` assets crisp and grid-aligned without fake twists or forced symmetry, use `mirror-x` for
  paired limbs, and let the compiler auto-size UVs and pack atlases unless manual
  layout is required. Keep multi-part entries modular across all 4 asset kinds
  (`rig.ashfox`, `surface.ashfox`, `body.ashfox`, `sound`/`sprite`/`structure` modules under `assets/module/`): the compiler rejects unused imports, unused declarations, unused stamps, and monolithic or concern-mixing entries.
- Author textures with `density = 2` for `creature` and `prop` assets (`density = 1` for `block`), `render-mode = emissive` on glowing surfaces, `tone painterly`, `material = double` + `coverage = binary` bitmasks for thin `plane` cutouts, calm rest areas (20–42% pre-grain delta with moderate `ao` and omitted-`from` `gradient`), warm darks (`luma >= 0.14`, no near-black crush), painted face `stamp` details (`protect = true`) instead of protruding 1u micro-brick decals, and material-appropriate `grain` (`clustered` for fur/stone/bark, `soft` for cloth/leather, `none` for eyes/metal/gems).
- Run `ashfox check <source>` alongside visual inspection: hit **0 failed Hard Gates**
  and `audit.score >= 75` (target `>= 85` `excellent`). `ashfox build` blocks any model
  or structure failing its quality profile or Hard Gates.
- Declare `preview <name> { ... }` blocks in the `.ashfox` source (e.g., `sheet = turnaround`,
  `sheet = inspect`, `texture = ...`, `kind = gif; clip = ...`, `cutaway = <y>`, `stage = silhouette`)
  and render them via `ashfox render <source> --view <name> [--output <file>]`.
  Build playable WAV/OGG sound variants via `ashfox build` and listen to them. Compilation alone does not establish visual or audio quality.
- Pass `--stdin` or `--input-json` to `check` or `render` when operating on
  source graphs in memory.
- For game delivery, run `check <workspace>`, `build <workspace>`, and `check <build-dir>`.
  Consume deterministic outputs through the game's adapter; do not hand-edit
  generated PNG, GLB, audio or runtime manifests.
- Save or build the outputs requested by the user (`outputs { ... }`). Report exact output locations,
  `check` audit score/profile, what views were inspected/rendered, and any behavior still unverified in
  the receiving game. Do not claim successful output from a preflight check alone.
- For Minecraft/GLB buildings (`structure <id>`), `outputs { java_structure; glb; }` builds both Java `.nbt` and `1 block = 1.0m` GLB (standalone default), embed custom `.ashfox` props
  via `palette` (`asset alias as "minecraft:..."`), and inspect furnished rooms with a declared `preview ... { cutaway = <y>; }` rendered via `ashfox render --view <name>`.

## Skill updates

The current user guides and installed CLI are sufficient for asset work. When a
skill update is relevant, `scripts/sync.py` checks availability without changing
files. Use `--install` only when the user requests a skill update, then reread
this file. The installer refuses repository checkouts; do not bypass its checks.

## Procedural sound delivery

Use the current sound reference from CLI docs before authoring. Native sound uses
reusable `voices`, finite `sequences`, scalar-or-curve controls, explicit `vary`
ranges, and `playback`. Gain is fixed `output.gainDb`; peak excess is a failure.
Old layers, attack/release, chirp contour, pitch pairs and rmsDb are rejected.
Keep `ashfox-model 1`; never introduce a sound version field or fallback source.

For loops, inspect raw and delivered frames: crossfade is baked once and shortens
the output. Standalone WAV consumers must loop the full buffer; game consumers
must honor playback metadata. Do not deliver loop OGG or Minecraft packs.
Audition variants and at least 20 loop cycles, then report actual listening
evidence separately from waveform/peak/seam measurements. Do not claim animal
or material realism from numerical checks. Verify the installed CLI contract
fingerprint and official package before presenting a newly authored DSL source.
