# LLM Texture Strategy (bbmcp)

Use this guide to keep UVs and textures consistent across parts.

Note: If low-level tools are hidden, use `texture_pipeline` for the entire workflow.

## Auto Plan (No Manual UV)
Use `texture_pipeline.plan` to auto-generate textures + UVs from high-level intent, then paint with presets or ops.
Plan uses a texel-density solver to pick resolution + texture count, caps auto plans at 512px, and respects format constraints (e.g., single-texture formats disable splitting).

Example (auto UV + preset paint):
```json
{
  "plan": {
    "name": "tractor",
    "detail": "high",
    "allowSplit": true,
    "maxTextures": 2,
    "paint": { "preset": "painted_metal", "palette": ["#c73b2b", "#9f2c25", "#d94b3b"] }
  },
  "autoRecover": true,
  "preview": { "mode": "fixed", "output": "single", "angle": [30, 45, 0] }
}
```

## Face Paint (Material-First, UV-Free)
Use `texture_pipeline.facePaint` to describe materials per cube/face. The pipeline maps materials to presets, targets UV rects automatically, and can auto-plan UVs when `autoRecover=true`.

Example (material pass):
```json
{
  "plan": { "name": "tractor", "detail": "high", "maxTextures": 1 },
  "facePaint": [
    { "material": "metal", "cubeNames": ["body"], "faces": ["north", "south", "east", "west"] },
    { "material": "glass", "cubeNames": ["window"] },
    { "material": "rubber", "cubeNames": ["wheel_left", "wheel_right"] }
  ],
  "autoRecover": true,
  "preview": { "mode": "fixed", "output": "single", "angle": [30, 45, 0] }
}
```

## Primary Workflow
1) `assign_texture`
2) `preflight_texture`
3) `apply_uv_spec` (or `set_face_uv`)
4) `preflight_texture` again
5) `apply_texture_spec` or `generate_texture_preset`
6) `render_preview`

Notes:
- Use `ifRevision` for mutations.
- Call `preflight_texture` without texture filters to get a stable `uvUsageId`.

## Error Recovery (Always)
If `validate` reports `uv_overlap` / `uv_scale_mismatch`, UVs are missing, or a mutation returns `invalid_state` mentioning overlap/scale or uvUsageId mismatch:
1) Prefer `texture_pipeline.plan` to re-pack UVs with the solver (auto-split, <=512).
2) Repaint with `apply_texture_spec` or `generate_texture_preset`

Tip: `texture_pipeline` enables autoRecover by default during paint/facePaint steps. It runs a single plan-based recovery automatically for the whole project (auto-split, <=512, max 16 textures) and retries once.
For mid/high-poly assets, prefer `texture_pipeline.plan` for repeatable results.

## Common Pitfalls
- All faces mapped to full texture (e.g., [0,0,32,32]) causes scale mismatch.
- Changing textureResolution after painting requires repainting.
- UV overlap is only allowed if rectangles are identical.

## Macro Tool (Optional)
Use `texture_pipeline` to run the standard flow in one call:
`assign_texture ??preflight_texture ??apply_uv_spec ??preflight_texture ??apply_texture_spec/generate_texture_preset ??render_preview`.

Example (textures + preview):
```json
{
  "assign": [{ "textureName": "pot", "cubeNames": ["pot"] }],
  "uv": { "assignments": [{ "cubeName": "pot", "faces": { "north": [0,0,16,16] } }] },
  "textures": [{ "mode": "create", "name": "pot", "width": 16, "height": 16, "ops": [] }],
  "preview": { "mode": "fixed", "output": "single", "angle": [30, 45, 0] },
  "autoRecover": true
}
```

## Minimal Examples

Preflight:
```json
{ "includeUsage": true }
```

Atlas:
```json
{ "apply": true }
```

Generate preset:
```json
{
  "preset": "wood",
  "name": "pot_wood",
  "width": 64,
  "height": 64,
  "uvUsageId": { "$ref": { "kind": "tool", "tool": "preflight_texture", "pointer": "/uvUsageId" } },
  "mode": "create"
}
```
