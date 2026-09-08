---
name: ashfox
description: Create, refine, animate, and visually review Minecraft-style block and pixel assets in the ashfox Web Workbench. Use for ashfox modeling and export preparation, not repository development or direct Blockbench editing.
---

# ashfox

Use the Workbench to execute the user's asset request. The live runtime
manifest owns the current language, API, review requirements, and delivery
workflow. This skill is a connection guide, not a second grammar or schema.

## Connect to ashfox.io

1. Choose the connection before running any sync helper: use
   `https://ashfox.io/workbench/` by default.
   Use a local/development Workbench only when explicitly selected by the user;
   in that case use its own `agent-manifest.json` and skip production and skill
   sync entirely.
2. For production, the current live manifest is sufficient to carry out asset
   work. Run `scripts/sync.py` with system Python only when checking skill
   updates is relevant; its default checks availability without changing files.
   Install only when the user explicitly requests a skill update, using
   `scripts/sync.py --install`, then reread the updated `SKILL.md`. Installation
   refuses repository checkouts. If verification or installation fails, continue
   with the live manifest; do not manually patch the installed skill or weaken
   verification.
3. Fetch `https://ashfox.io/workbench/agent-manifest.json` (or the explicitly
   selected development equivalent) through a direct HTTP tool such as `curl`.
   Open the chosen Workbench in an in-app browser when available, otherwise a
   connected browser. Reuse the user's tab and keep it on the app; do not
   navigate it to JSON or mix a development app with the production manifest.
4. Inspect the active project before acting. If the manifest or app is
   unavailable, report the connection problem instead of guessing commands
   from cached instructions.

## Carry out the request

- If the user already described the work, continue from that request. Ask what
  to create or change only when the task is missing. A request to inspect or
  explain an asset does not authorize editing it.
- For refinements, preserve the existing silhouette, palette, pixel density,
  and focal details unless the user asks to change them. Follow the manifest's
  precision authoring and observation guidance for linked dimensions and
  fixed-size pixel marks; do not substitute smooth CAD geometry.
- Read current schemas before constructing unfamiliar payloads. Edit only
  workspace source through the current atomic change API. Never patch the
  derived scene, texture raster, DOM, or storage to author an asset.
- Review actual rendered frames and motion before accepting visual evidence.
  Measurements and successful compilation do not certify appearance. On a
  stale response, refresh the current identity and restage against it.
- Complete the manifest's review and capture workflow when delivering an
  asset. Do not claim export success from preflight alone. Ask about the export
  target only when delivery requires it; leave final delivery to the user.

Fetch the live manifest again after a product update. Do not copy its language
rules or request schemas into this skill.
