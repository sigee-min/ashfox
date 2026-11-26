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
- Author textures with `density = 2` for `creature` and `prop` assets (`density = 1` for `block`), `render-mode = emissive` on glowing surfaces, `tone painterly`, `material = double` + `coverage = binary` bitmasks for thin `plane` cutouts, calm rest areas (`ramp(#hex, preset)` OKLCH hue-shifted ramps, moderate `ao`, omitted-`from` `gradient`, directional `fur`/`wood`/`cloth`/`brushed` grain, subtle `pattern edge`), warm darks (`luma >= 0.14`, no near-black crush), and painted face `stamp` details (`protect = true`) instead of protruding 1u micro-brick decals.
- For sprites and seamless tiles (`16`/`32`/`64`, `32` recommended), set `profile = item | tile | icon | decal`, compose with OKLCH `auto` ramps, parametric `shape` primitives or `fill` wrapping patterns, and `outline { mode = sel_out; strength = 2; innerRim = true; }`.
- Run `ashfox check <source>` alongside visual inspection across models, sprites, sounds, and structures: hit **0 failed Hard Gates** and `audit.score >= 75` (target `>= 85` `excellent`). `ashfox build` blocks any asset failing its quality profile or Hard Gates.
- Declare `preview <name> { ... }` blocks in the `.ashfox` source (e.g., `sheet = turnaround`,
  `sheet = inspect` for pure-CPU 512×512 sprite/tile or 800×520 sound diagnostic sheets, `texture = ...`, `kind = gif; clip = ...`, `cutaway = <y>`, `stage = silhouette`)
  and render them via `ashfox render <source> --view <name> [--output <file>]`.
  Build playable WAV/OGG sound variants via `ashfox build` and listen to them. Compilation alone does not establish visual or audio quality.
- Pass `--stdin` or `--input-json` to `check` or `render` when operating on
  source graphs in memory.
- For game delivery, run `check <workspace>`, `build <workspace>`, and `check <build-dir>`.
  Consume deterministic outputs through the game's adapter; do not hand-edit
  generated PNG, GLB, audio or runtime manifests. Multi-asset `game_assets` packs
  automatically deduplicate identical GLB PNG textures into `textures/<hash12>.png`
  (`sharedTextures` in `assets.json`), and GLB exports embed 3-tier LOD (`*_LOD0/1/2`
  + `MSFT_lod`) targeting runtime budgets (`creature`/`prop` `<= 4` draws [`<= 2` skinned] /
  `<= 1,500` tris / `<= 45 KB`; `structure` `<= 18` draws / `<= 18,000` tris / `<= 350 KB`;
  `compound` `<= 28` draws / `<= 45,000` tris / `<= 1.1 MB`, `LOD2 == 1` draw).
- Save or build the outputs requested by the user (`outputs { ... }`). Report exact output locations,
  `check` audit score/profile, what views were inspected/rendered, and any behavior still unverified in
  the receiving game. Do not claim successful output from a preflight check alone.
- For Minecraft/GLB buildings (`structure <id>` or `compound <id>` under `assets/structures/`), author with `density = 2`, `seed`, `mix(...)` material palettes, semantic `floor`/`room`/`facade`/`staircase`/`roof`/`furnish`/`weathering`/`socket`/`compound_place` ops, and Lv4 custom props (`assets/models/props/*.ashfox`) via `palette` (`asset alias as "minecraft:..."`). `outputs { java_structure; glb; }` builds `.nbt`, baked Voxel AO/lightmap `1 block = 1.0m` `.glb`, and `.structure.json` (`PlayableStructureMeta`), which `game_assets` packs can bind directly. Inspect exteriors, per-floor horizontal sections, and interior eye-level views with `preview ... { sheet = exterior | cutaway | interior; }` (or `cutaway = <y>`) rendered via `ashfox render --view <name>`, and hit 0 failed Hard Gates (`playable_circulation`, `weatherproof_enclosure`, etc.) with `audit.score >= 75` (target `>= 85`).

## Skill updates

The current user guides and installed CLI are sufficient for asset work. When a
skill update is relevant, `scripts/sync.py` checks availability without changing
files. Use `--install` only when the user requests a skill update, then reread
this file. The installer refuses repository checkouts; do not bypass its checks.

## Procedural sound delivery

Use the current sound reference from CLI docs before authoring. Set explicit `profile` (`impact`, `foley`, `creature`, `magic`, `ui`, `ambient`) and optional `channels = 2` / `space` (FDN-8 `preset` or parameters) / `drive` / Cytomic `filter` / `ad`/`adsr` `envelope` / `output` mastering (`targetLufs`, `punch`, `warmth`, `air`, `glue`, `width`, `limit = true`). Native sound uses reusable `voices`, finite `sequences`, scalar-or-curve controls, `material`/`granular`/`osc`/`noise`/`fm`/`vocal`/`chirp`/`resonator` sources, optional `vary` defaults, and `playback`. Output uses `output.gainDb`/`peakDb` mastering; legacy `layers`, `attack`, `release`, `contour`, `sweepSeconds`, `rmsDb`, `output.softClip`, and `noise.color = "crackle"` are rejected.

For loops, inspect raw and delivered frames: crossfade is baked once and shortens
the output. Standalone WAV consumers must loop the full buffer; game consumers
must honor playback metadata. Do not deliver loop OGG or Minecraft packs.
Declare `preview inspect { sheet = inspect; }` and run `ashfox render <source> --view inspect` to inspect the 4-panel waveform/spectrogram/6-band/variant sheet, then audition variants and at least 20 loop cycles directly, reporting listening evidence separately from numeric measurements.
