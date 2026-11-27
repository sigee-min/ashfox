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
- For models (`ashfox 1`, `model <id>`), set `settings.profile = creature | prop | block` explicitly. Use
  Hytale / modern Blockbench craft instead of bare boxes and flat 1-line `fill`
  coats: decompose organic limbs with tapered `15°`/`22.5°`/`45°` joints and thin
  `plane` silhouettes (`ears`, `tufts`, `fins`, `plumes`) on `creature`/`prop` assets, keep `block` assets crisp and grid-aligned without fake twists or forced symmetry, use `mirror_x` for
  paired limbs, and let the compiler auto-size UVs and pack atlases unless manual
  layout is required. Keep multi-part entries modular across all 4 asset kinds
  (`rig.ashfox`, `surface.ashfox`, `body.ashfox`, `sound`/`sprite`/`structure` modules under `assets/module/`): the compiler rejects unused imports, unused declarations, unused stamps, and monolithic or concern-mixing entries.
- Author textures with `density = 2` for `creature` and `prop` assets (`density = 1` for `block`), `render_mode = emissive` on glowing surfaces, `tone painterly`, `material = double` + `coverage = binary` bitmasks for thin `plane` cutouts, calm rest areas (`ramp(#hex, preset)` OKLCH hue-shifted ramps, moderate `ao`, omitted-`from` `gradient`, directional `fur`/`wood`/`cloth`/`brushed` grain, subtle `pattern edge`), warm darks (`luma >= 0.14`, no near-black crush), and painted face `stamp` details (`protect = true`) instead of protruding 1u micro-brick decals.
- For sprites and seamless tiles (`16`/`32`/`64`, `32` recommended), set `profile = item | tile | icon | decal`, compose with OKLCH `auto` ramps, direct parametric shapes (`rect`, `ellipse`, `capsule`, `polygon`, `line`) or `fill` wrapping patterns using `px` coordinates and `to_material`, and `outline name { mode = sel_out; strength = 2; inner_rim = true; }`.
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
- For Minecraft/GLB buildings (`structure <id>` or `compound <id>` under `assets/structures/`), author with `ashfox 1`, `density = 2`, `seed`, `mix(...)` material palettes, `{ key = value; }` semantic `floor`/`room`/`facade` (including `stained_glass_color`)/`staircase`/`roof`/`interior` (`dna`, `architecture`, `platform`/`sunken`, `mezzanine`, `open_truss`, `alcove`, `partition`, `wall_line`, `centerpiece`, `drapery`, `story`, `lighting`, `sun_shaft`)/`furnish`/`weathering`/`anchor`/`volume`/`zone`/`mc_block`/`compound_place` blocks (`b` units, using `anchor ... : std.entry|std.road|std.wall_join|std.courtyard` and shared `export schema` hooks imported from `assets/module/*.ashfox` instead of inline `schema` definitions, without stair/slab furniture hacks), and custom props (`assets/models/props/*.ashfox`) via `palette` (`asset(alias, "minecraft:...")`). `outputs = [java_structure, glb];` builds `.nbt` (`data_version = 3955`), 2-bounce radiosity GI + additive `sun_shaft` + double-sided translucent glass `1 block = 1.0m` `.glb` (with `anchor_*` Empty Nodes + `extras.ashfox.hooks`), `<target>.hooks.json` (plus optional `--bindings ts,cs,gd`), and `.structure.json` (`PlayableStructureMeta` with interior interaction/audio hooks), which `game_assets` packs can bind directly. Inspect exteriors, per-floor horizontal sections, and raycast-clear interior eye-level views with `preview ... { sheet = exterior | cutaway | interior; }` (or `cutaway = <y>`) rendered via `ashfox render --view <name>`, and hit 0 failed Hard Gates (`playable_circulation`, `weatherproof_enclosure`, etc.) with `audit.score >= 75` (target `>= 85`).

## Skill updates

The current user guides and installed CLI are sufficient for asset work. When a
skill update is relevant, `scripts/sync.py` checks availability without changing
files. Use `--install` only when the user requests a skill update, then reread
this file. The installer refuses repository checkouts; do not bypass its checks.

## Procedural sound delivery

Use `ashfox 1` sound syntax (`sound <id>`) from CLI docs before authoring. Native sound uses `snake_case` declarative blocks (`voice <id> : <type> { ... }`, `seq <id> { start = ...; repeat { ... } step <id> { voice = ...; at = ...; duration = ...; vary_timing = a..b; vary_pitch = a..b; vary_gain = a..b; } }`, `space { ... }`, `loop { at = <start>..<end>; [xfade = <dur>;] }` or `playback = oneshot;`, `variants { ... }`, and `master { [gain = <db>;] [target = <lufs>;] peak = <db>; [punch] [warmth] [air] [glue] [width] [limit = true]; }`, defaulting to `sample_rate = 48000hz`, true-stereo `channels = 2`, `oneshot`, and auto `base`/`alternate` variants). Modules declare `params { ... }` and `export voice <id> : <type> { ... }`, imported with `import "../module/kit.ashfox" as kit { key = val; };`.

Set explicit `profile` (`impact`, `foley`, `creature`, `magic`, `ui`, `ambient`), unit-typed scalars/curves (`ms`, `s`, `hz`/`khz`, `db`, `lufs`, `cents`/`st`, `%`, `log(...)`, `lin(...)`, `smooth(...)`, `-0.65 -> 0.65`), `gain { env = ad|adsr; ... }` envelopes, true-stereo sources (`material`/`modal_plate` with `twin_beat`/`splash`/`stereo_spread`, `granular` with `stereo_width`/`itd_ms`, `whoosh`/`aero_whoosh` with `velocity`/`thickness`/`doppler`/`sweep_pan`, `waveguide` with `string`/`blade`/`creak`/`pipe`, cascade LF-glottal `vocal` with unquoted `vowels`/`rattle`, `osc`, `noise`, `fm`, `chirp`), and per-voice processors (`highpass`, `lowpass`, Cytomic `filter`, `eq`, `drive`, `fx` `chorus`/`phaser`/`delay`/`shimmer`, dynamic `pan`, `duck`, circular Perlin `drift`) with true-stereo FDN-8 `space`. Legacy `ashfox-model 1` headers, JSON arrays (`voices = [...]`, `sequences = [...]`, `{ domain = ...; }`), `camelCase` keys, quoted enum strings, `timeline`, `resonator`, `layers`, `output.rmsDb`, `output.softClip`, and `noise.color = "crackle"` are rejected.

For loops, inspect raw and delivered frames: crossfade is baked once and shortens
the output. Standalone WAV consumers must loop the full buffer; game consumers
must honor playback metadata. Do not deliver loop OGG or Minecraft packs.
Declare `preview inspect { sheet = inspect; }` and run `ashfox render <source> --view inspect` to inspect the 4-panel waveform/spectrogram/6-band/variant sheet, then audition variants and at least 20 loop cycles directly, reporting listening evidence separately from numeric measurements.
