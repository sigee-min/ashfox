# Texture Pipeline Plan (Final)

## Purpose
Define the final texture pipeline for bbmcp, grounded in Blockbench texture API/UX and optimized for LLM-driven workflows. This document is designed so a developer can implement the pipeline end-to-end without additional design decisions.

## Goals
- Provide an LLM-friendly, deterministic texture workflow.
- Avoid filesystem dependence for texture creation and updates.
- Guarantee revision and diff accuracy for every mutation.
- Keep tool schemas strict and stable.
- Align behavior with Blockbench texture APIs (Texture, TextureLayer, Painter).

## Non-goals
- Advanced brush UI or interactive painting.
- External storage or CDN integration for textures.
- Long-running raster effects (filters, procedural noise).
- Client-side planning/compilation logic (ops must already be provided by the caller).

## Constraints and Assumptions
- Blockbench desktop with DOM/Canvas available.
- All mutating calls require `ifRevision`.
- `limits.maxTextureSize` is enforced.
- Textures are created in-memory from ops and rendered to data URIs internally.
- Preview and texture editing must not rely on filesystem writes.

## Blockbench API/UX Baseline (Source of Truth)
These API signatures are visible in the official `blockbench-types` package and should be used as guidance.

- `Texture` supports `fromDataURL`, `getDataURL`, `getBase64`, `edit(...)`, and `updateChangesAfterEdit()` and can be created in memory.
  - Reference: https://unpkg.com/blockbench-types@5.0.6/custom/textures.d.ts
- `TextureLayer` exposes `canvas` and `ctx`, and can resize layers.
  - Reference: https://unpkg.com/blockbench-types@5.0.6/custom/texture_layers.d.ts
- `Painter` namespace reflects paint tool UX (brush, selection, mirror).
  - Reference: https://unpkg.com/blockbench-types@5.0.6/custom/painter.d.ts

### UX Implications
- Canvas-based edits are the default UX path and align with deterministic ops.
- Data URIs are an internal transport for apply_texture_spec (not a public tool input).
- Edits should be wrapped in undo/redo boundaries consistent with Blockbench UX.

## LLM Strategy Rationale (Research-Backed)
The pipeline is designed around evidence from tool-using LLM studies:
- ReAct: observation-action-observation loops improve reliability.
  - https://arxiv.org/abs/2210.03629
- Toolformer and Gorilla: declarative tools reduce failure rates.
  - https://arxiv.org/abs/2302.04761
  - https://arxiv.org/abs/2305.15334
- Reflexion and Self-Refine: iterative correction loops improve quality.
  - https://arxiv.org/abs/2303.11366
  - https://arxiv.org/abs/2303.17651
- InstructPix2Pix and MagicBrush: structured edit instructions improve image editing.
  - https://arxiv.org/abs/2211.09800
  - https://arxiv.org/abs/2306.10012

## Pipeline Overview
1) Validate payload and enforce limits.  
2) Preflight mapping: call `preflight_texture` to build the UV mapping table.  
3) Render a checker/label texture to verify orientation before final paint.  
4) Resolve base texture (optional) for update/patch flows.  
5) Render data URI via in-memory canvas and atomic ops.  
6) Create/update texture through Blockbench API (internal).  
7) Bind textures to cubes explicitly via `assign_texture` (separate tool).  
8) Apply per-face UVs with `set_face_uv` (manual UV only).  
9) Refresh snapshot, compute revision and diff.  
10) Return ToolResponse with report + state (+ diff).

## Pipeline Stages (Detailed)

### Stage A: Observe
- Call `get_project_state` to fetch:
  - current revision
  - textures list (id, name, size, path)
  - format and limits
- This step is mandatory before any mutation.
  - Also call `preflight_texture` to build the UV mapping table (face -> UV rect).
  - If UVs change later, repaint using the new mapping.

### Preflight Gate (Required for Painting)
- Build a UV mapping table from `preflight_texture`.
- Paint a checker/label texture first and preview it to verify orientation.
- Only then apply the final texture paint ops.

### Stage B: Apply (Ops Only)
- Create:
  - Render data URI via canvas.
  - Create using `Texture.fromDataURL()` + `Texture.add()`.
- Update:
  - Resolve base texture by id/name.
  - Render new data URI using base image.
  - Apply using `Texture.edit(...)` or `Texture.fromDataURL()` + `Texture.updateChangesAfterEdit()`.

### Stage C: Assign (Explicit)
- `apply_texture_spec` does not assign textures to cubes.
- Use `assign_texture` to bind a texture to target cubes/faces.
- Use `set_face_uv` to place per-face UVs explicitly (no auto-UV).
- Treat assignment and UV mapping as separate steps so LLMs can control scope and layout.

### Stage D: Verify
- Snapshot again and confirm:
  - revision advanced
  - textures count updated
  - diff reflects texture changes
- If no changes detected, return `invalid_payload` or `no_change` error.

### Stage E: Refine
- LLM can re-run with small ops (overlay lines, fill bands) using update mode.


## Data Model

### TextureSpec
Used by `apply_texture_spec`. This payload is intentionally minimal so LLMs focus on pixel ops.

Required:
- `name` (string) for create
- `width` / `height` (number, > 0)

Optional:
- `mode`: `create | update` (default `create`)
- `id`: caller-defined ID
- `targetId` / `targetName`: for update mode
- `background`: hex color string
- `useExisting`: boolean (update mode)
- `ops`: array (omit for a blank texture; background can still fill)

### TextureOp
All ops are applied in order and are deterministic.

Supported ops:
- `set_pixel`: `{ op, x, y, color }`
- `fill_rect`: `{ op, x, y, width, height, color }`
- `draw_rect`: `{ op, x, y, width, height, color, lineWidth? }`
- `draw_line`: `{ op, x1, y1, x2, y2, color, lineWidth? }`

## Tool Surface

Primary:
- `apply_texture_spec` (create/update via ops)

Low-level:
- `delete_texture`
- `assign_texture` (bind texture to cubes/faces)
- `set_face_uv` (manual per-face UVs)
- `preflight_texture` (verify face bindings and UVs)

### Tool Guidance
- `apply_texture_spec` is the default path for LLMs.
- Image import via file path or data URI is not exposed; ops-only is required.
- `assign_texture` is required to make textures visible on cubes.
- If UVs exceed the current textureResolution, increase it (set_project_texture_resolution) or split textures per material group. Use modifyUv=true only when you want existing UVs scaled (if supported by the host).
- Omitting ops creates a blank texture (background can still fill).
- High-level plans must be compiled into ops client-side to avoid schema drift.
- Always build the UV mapping table via `preflight_texture` before painting.
- If UVs change after painting, repaint using the updated mapping.

Recommended LLM flow:
1) `get_project_state`
2) `apply_texture_spec` with `ifRevision`
3) `assign_texture` to bind textures to cubes/faces
4) `set_face_uv` to set per-face UVs
4) `get_project_state` to confirm counts/revision

## Rendering Rules
- Canvas size is derived from spec width/height.
- `imageSmoothingEnabled = false`.
- `background` is applied before ops.
- Base image is drawn before ops when updating.
- Ops render in order for deterministic results.
- Out-of-bounds ops are clipped by the canvas.
- If a base texture is unavailable, return `not_implemented`.

## Validation Rules
- `width/height` must be finite and > 0.
- `width/height` must be <= `limits.maxTextureSize`.
- `ops` is optional; if provided, it must be a valid array of ops.
- `name` is required on create.
- `targetId` or `targetName` required on update.
- Reject unknown ops with `invalid_payload`.
- Reject `ops` count > `maxOps` (default 4096) with `invalid_payload`.
- Reject create ops with very low opaque coverage (<5%) to avoid invisible textures when UVs reference full regions.

## State and Revision
- On success: revision must advance and diff must reflect changes.
- On no-op: respond with `invalid_payload` or explicit `no_change` error.
- `includeState` and `includeDiff` must be honored consistently.

## Error Codes
- `invalid_payload`: schema or semantic errors.
- `not_implemented`: missing DOM/canvas/Texture API.
- `io_error`: Blockbench import/update errors.
- `unknown`: unexpected exceptions.

## Security and Limits
- Enforce strict op bounds to avoid CPU spikes.
- Reject dataUri larger than a soft limit (e.g., 4 MB).
- Reject textures exceeding `maxTextureSize`.
- Avoid filesystem usage for texture ops.

## Observability
- Log counts and operation names for `apply_texture_spec`.
- Include `report.applied.textures` and `report.errors[]`.
- Include `report.textureCoverage` (opaque ratio + bounds) for each rendered texture.
- Add diagnostics only for failures (avoid bloating success payloads).
- Log when update mode uses a base texture and whether it was found.

## Implementation Plan

### Phase 1: Schema and Validation
- Confirm `apply_texture_spec` schema in `src/mcp/tools.ts`.
- Enforce strict validation in `src/proxy/validators.ts`.
- Add error messages that map to exact fields and modes.
- Do not add plan fields to tool payloads to avoid schema drift.

### Phase 2: Render Engine
- Keep rendering in `src/proxy/texture.ts`.
- Ensure `document` and canvas access are required and checked.
- Update mode uses `useExisting=true` to pull the current texture internally (no separate tool).
- Guarantee deterministic op order and clipping behavior.
- Add `maxOps` guard to protect render time.

### Phase 3: Blockbench Integration
- Use `BlockbenchTextureAdapter` for create/update/delete (dataUri from ops).
- Ensure Undo usage wraps texture edits.
- Store `bbmcpId` for stable references.
- Prefer `Texture.fromDataURL` and `Texture.updateChangesAfterEdit`.

### Phase 4: State, Diff, Revision
- Update snapshot and revision only on successful mutation.
- Ensure `apply_texture_spec` returns updated state counts.
- Confirm `diff.textures` reflects additions/changes/removals.

### Phase 5: LLM Ergonomics
- Provide a minimal example in docs (create + update).
- Add guidance to `capabilities` or tool descriptions:
  - Always include `ifRevision`.
  - Use `apply_texture_spec` for deterministic results.
- Add a quick reference for op usage in README (optional).

## Module Map (Where to Implement)
- Schemas: `src/mcp/tools.ts`
- Validation: `src/proxy/validators.ts`
- Texture render ops: `src/proxy/texture.ts`
- Apply flow: `src/proxy/apply.ts`
- Editor integration: `src/adapters/blockbench/BlockbenchTextureAdapter.ts`
- State/diff: `src/services/projectState.ts`, `src/services/diff.ts`

## Acceptance Criteria
- `apply_texture_spec` create increases `textures` count and revision.
- `apply_texture_spec` update changes data and revision.
- `assign_texture` updates cube/face bindings without changing UVs.
- `set_face_uv` updates per-face UVs deterministically.
- `delete_texture` removes by name/id and updates revision.
- Update mode with `useExisting=true` renders from the current texture and preserves size.
- `validate` returns `texture_too_large` when over limit.
- Every mutation returns consistent `report`, `state`, and `diff`.
- Ops with out-of-bounds coordinates do not throw.
- Update mode returns `invalid_payload` if target is missing.
- Tool schema rejects unknown fields (ensures LLM does not drift).

## Example: Create Texture (16x16)
```json
{
  "textures": [
    {
      "mode": "create",
      "name": "flower_pot",
      "width": 16,
      "height": 16,
      "background": "#7a4a21",
      "ops": [
        { "op": "fill_rect", "x": 0, "y": 0, "width": 16, "height": 16, "color": "#7a4a21" },
        { "op": "draw_rect", "x": 0, "y": 0, "width": 16, "height": 16, "color": "#4b2a12", "lineWidth": 1 },
        { "op": "fill_rect", "x": 2, "y": 2, "width": 12, "height": 3, "color": "#8b5a2b" }
      ]
    }
  ],
  "ifRevision": "<revision>",
  "includeState": true,
  "includeDiff": true,
  "diffDetail": "summary"
}
```

## Example: Update Texture (Overlay)
```json
{
  "textures": [
    {
      "mode": "update",
      "targetName": "flower_pot",
      "width": 16,
      "height": 16,
      "useExisting": true,
      "ops": [
        { "op": "draw_line", "x1": 2, "y1": 8, "x2": 13, "y2": 8, "color": "#6a3b18", "lineWidth": 1 }
      ]
    }
  ],
  "ifRevision": "<revision>",
  "includeState": true
}
```

## MCP Vision Output (Required for Auto-Analysis)
If the client needs automatic vision analysis, `render_preview` must return MCP content blocks.
JSON-only base64 fields are NOT enough.

```json
{
  "content": [
    {
      "type": "image",
      "mimeType": "image/png",
      "data": "<base64>"
    }
  ],
  "meta": {
    "kind": "single",
    "width": 766,
    "height": 810,
    "byteLength": 67336
  }
}
```
