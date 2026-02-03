# Texture Pipeline (Current)

## Purpose
Document the current texture workflow and tool behavior used by bbmcp.

## Tool Surface
Primary:
- `texture_pipeline` (macro pipeline)

Supporting tools:
- `assign_texture`, `set_face_uv`
- `preflight_texture`
- `apply_uv_spec`
- `apply_texture_spec`
- `generate_texture_preset`
- `auto_uv_atlas` (low-level only)
- `render_preview`
- `read_texture`
- `set_project_texture_resolution`

Note: Supporting tools may be hidden; prefer `texture_pipeline` for the full workflow.

## texture_pipeline Behavior
- Accepts steps: `plan`, `assign`, `preflight`, `uv`, `textures`, `presets`, `facePaint`, `cleanup`, `preview`.
- Requires at least one step.
- When `plan` is provided, it auto-generates textures + assignments + UVs using an internal atlas + texel-density solver (no auto_uv_atlas call).
- Avoid targeting plan-created texture names in `textures`/`presets` within the same call; use a follow-up call instead.
- `plan` cannot be combined with explicit `assign`/`uv` in the same call; split into separate calls for manual overrides.
- Planning respects format constraints (e.g., single_texture disables splitting) and may reduce density if the model cannot fit.
- The solver chooses resolution + texture count, clamps to min(max texture size, 512), and avoids resolution growth loops.
- Runs `preflight_texture` automatically when UV or paint steps are present.
- If the UV step runs and `preflight` is requested, it preflights again after UV changes.
- For texture/preset steps, it ensures a valid `uvUsageId` (preflighting if needed).
- Enforces UV guards (usage id, overlap, scale).
- Automatic recovery runs a single plan-based UV recovery for the whole project (auto-split, <=512, max 16 textures, no auto_uv_atlas) on overlap/scale/usage mismatch or missing UVs, then retries once.
- `facePaint` maps material keywords to preset textures and targets cube faces (via uvPaint). It requires a valid UV mapping; the pipeline can auto-plan UVs before painting.
- Do not mix `facePaint` with explicit `textures`/`presets` targeting the same texture names in a single call; split into separate calls.
- Applied `facePaint` intents are stored in project meta so follow-up passes can reuse the same material mapping.
- Unknown `facePaint` materials return an error. Use supported material keywords or provide palettes.
- `facePaint` respects non-square `resolution` overrides (e.g., 32x16) when provided.
- For formats with `perTextureUvSize=true`, facePaint does not fall back to project texture resolution; ensure per-texture sizes exist.
- Painting is uvPaint-only (no raw image import tool).
- Honors `ifRevision` for mutation steps; preview is read-only.
- If `planOnly=true` or the payload is underspecified, the pipeline skips mutations and returns `nextActions` with short `ask_user` prompts.
- `facePaint` cannot run with `planOnly=true`; run facePaint in a follow-up call after planning.
- `autoStage` (default true) runs plan/assign/uv/paint in staged order with a preflight refresh before painting.
- `cleanup` deletes explicitly listed textures; when `force=false` (default), deletion fails if textures are still assigned to cubes.

## apply_texture_spec / generate_texture_preset
- Require `uvUsageId` and enforce UV guards.
- `apply_texture_spec` uses deterministic ops + uvPaint mapping and records `report.textureCoverage`.
- `generate_texture_preset` paints a procedural preset into uvPaint rects.
- `apply_texture_spec` / `generate_texture_preset` perform a single `auto_uv_atlas` + preflight retry when UV overlap/scale/missing issues occur.
- When automatic recovery changes UV layout or resolution, paint sizes are aligned to the recovered resolution automatically.
- Optional `detectNoChange=true` compares output to existing pixels and returns `applied: false` when identical (default false to avoid extra cost).

## apply_uv_spec
- Updates per-face UVs only.
- Requires `uvUsageId` and returns a refreshed `uvUsageId`.
- Suggests a follow-up preflight via `nextActions`.

## preflight_texture
- Computes `uvUsageId`, `uvBounds`, `usageSummary`, and optional `textureUsage`.
- Emits warnings for overlaps, unresolved references, and bounds issues.
- Recommends a resolution when bounds exceed the current size.
 - `textureUsage` entries may include per-texture width/height when available.
 - `uvUsageId` reflects per-texture width/height when available; resizing textures changes the id.
 - When per-texture sizes are missing, `uvUsageId` also incorporates the project texture resolution.

## Outputs (Structured)
- `texture_pipeline` returns `{ steps, applied, planOnly?, uvUsageId? }` (applied=false when planOnly).
- `apply_texture_spec` returns `{ applied: true, report, recovery?, uvUsageId? }`.
- `apply_uv_spec` returns `{ applied: true, cubes, faces, uvUsageId }`.
- `render_preview` returns MCP `content` image blocks plus structured metadata.

## Invariants
- Manual per-face UVs only.
- Overlapping UVs are errors unless identical.
- UV scale mismatch blocks painting and UV updates.
- Painting stays inside UV rects (uvPaint enforced).
