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
- For models, set `settings.profile = creature | prop | block` explicitly. Use
  Hytale / modern Blockbench craft instead of bare boxes and flat 1-line `fill`
  coats: decompose organic limbs with tapered `15°`/`22.5°`/`45°` joints and thin
  `plane` silhouettes (`ears`, `tufts`, `fins`, `plumes`), use `mirror-x` for
  paired limbs, and let the compiler auto-size UVs and pack atlases unless manual
  layout is required.
- Author textures with `density = 2` for `creature` and `prop` assets (`density = 1` for `block`), `render-mode = emissive` on glowing surfaces, `tone painterly`, `material = double` + `coverage = binary` bitmasks for thin `plane` cutouts, calm rest areas (20–42% pre-grain delta with moderate `ao` and omitted-`from` `gradient`), warm darks (`luma >= 0.14`, no near-black crush), painted face `stamp` details (`protect = true`) instead of protruding 1u micro-brick decals, and material-appropriate `grain` (`clustered` for fur/stone/bark, `soft` for cloth/leather, `none` for eyes/metal/gems).
- Run `ashfox audit` alongside visual inspection: hit **0 failed Hard Gates**
  and `score >= 75` (target `>= 85` `excellent`). Delivery commands (`build` and
  `export`) block any model without `settings.profile` or failing the quality gate.
- Capture `--sheet turnaround` (`FRONT`, `3/4`, `SIDE`, `BACK`) and `--sheet
  inspect` (`3/4`, `FRONT`, `WIRE+RIG`, `TOP`), inspect `TEXTURE_ID` atlases,
  and replay each changed motion. Listen to sound variants. Successful
  compilation alone does not establish visual or audio quality.
- Use `ashfox stdio` for repeated operations on an asset in memory. Follow its
  revision contract when replacing the complete source graph.
- For game delivery, run check, build and verify against the configured workspace.
  Consume deterministic outputs through the game's adapter; do not hand-edit
  generated PNG, GLB, audio or runtime manifests.
- Save or export the files requested by the user. Report exact output locations,
  audit score/profile, what was inspected, and any behavior still unverified in
  the receiving game. Do not claim successful output from a preflight check alone.

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
