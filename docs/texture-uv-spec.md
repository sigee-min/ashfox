# Texture + UV Spec (bbmcp)

This document defines the canonical rules for UVs and texturing in bbmcp.

## Core Invariants
1) **Manual per-face UVs only**  
   Auto UV is not used in bbmcp flows. UVs must be explicit per face.

2) **Paint only inside UV rects**  
   `apply_texture_spec` and `generate_texture_preset` always paint into UV rects (uvPaint).

3) **No UV overlaps unless identical**  
   Overlapping UV rects are errors unless they are the exact same rect.

4) **Scale consistency is enforced**  
   For a given texture, the UV size for each face must match the expected size derived from the model dimensions and `uvPolicy`. If it does not, the call fails.

## Tool Responsibilities

### preflight_texture
- Builds UV mapping table.
- Computes `uvUsageId`.
- Reports overlaps and other warnings.

### apply_uv_spec
- **Only** updates per-face UVs.
- Must include `uvUsageId`.
- Fails if UV overlaps or UV scale mismatches exist.
- Requires faces to be bound to textures (via `assign_texture`).

### assign_texture / set_face_uv
- **Only** change bindings or UV coordinates.
- Do not paint.

### apply_texture_spec / generate_texture_preset
- **Only** paint.
- Must include `uvUsageId`.
- Fail if UV overlaps or UV scale mismatches exist.

### auto_uv_atlas
- Recomputes UV layout based on face sizes.
- Grows texture resolution (x2) if needed.
- Does **not** repaint textures.

## Expected UV Size
Expected UV size is computed from:
- `uvPolicy.modelUnitsPerBlock` (default 16)
- project texture resolution
- face dimensions (from cube size)

If the actual UV size deviates beyond `uvPolicy.scaleTolerance` (default 0.1), the operation fails.

## Recommended Flow
1) Create model.
2) `assign_texture` -- bind texture to cubes.
3) `preflight_texture` -- obtain `uvUsageId`.
4) `apply_uv_spec` -- set per-face UVs (or use `set_face_uv` directly).
5) `preflight_texture` -- obtain new `uvUsageId` after UV changes.
6) Paint using `apply_texture_spec` or `generate_texture_preset`.
7) If errors occur, run `auto_uv_atlas`, then re-preflight and repaint.

## Error Codes
- `uv_overlap` (validate): overlapping UV rects.
- `uv_scale_mismatch` (validate): UV size mismatch vs expected.
- `invalid_state` (apply/generate): blocking overlap or scale mismatch.

## Example: Apply Model Spec (Rooted Rig)
```json
{
  "model": {
    "rigTemplate": "empty",
    "parts": [
      { "id": "root", "size": [0,0,0], "offset": [0,0,0] },
      { "id": "body", "parent": "root", "size": [8,12,4], "offset": [-4,0,-2] }
    ]
  }
}
```

## Example: UV-First Texture Paint
```json
{
  "preset": "wood",
  "name": "pot_wood",
  "width": 64,
  "height": 64,
  "uvUsageId": "<from preflight_texture>",
  "mode": "create"
}
```
