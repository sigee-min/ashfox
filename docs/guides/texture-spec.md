# Texture + UV Spec (Summary)

Core rules:
1) Manual per-face UVs only.
2) Paint only inside UV rects (uvPaint enforced).
3) UV overlaps are errors unless identical.
4) UV scale mismatch is an error.

Workflow:
- assign_texture
- preflight_texture (uvUsageId)
- apply_uv_spec (or set_face_uv)
- preflight_texture again
- apply_texture_spec / generate_texture_preset
- texture_pipeline.plan when UVs are crowded (auto-split, <=512, max 16 textures)

Notes:
- preflight_texture computes uvUsageId; required by apply_uv_spec/apply_texture_spec/generate_texture_preset.
- validate reports uv_overlap/uv_scale_mismatch; mutation guards return invalid_state on overlap/scale/usage mismatch.
- Small or non-square UV rects can distort stretch-mapped patterns; consider tile mapping or higher resolutions for detailed patterns.
- If you see uv_scale_mismatch repeatedly, increase resolution (64+), reduce cube count, or allow split textures.
- no_change indicates the rendered pixels match the existing texture; change ops or rename to force an update.
- Automatic recovery may raise texture resolution to resolve uv_scale_mismatch.
- If you provide both cubeIds and cubeNames in targets, both must match. Use one for broader matching.

See full spec in docs/texture-uv-spec.md.
