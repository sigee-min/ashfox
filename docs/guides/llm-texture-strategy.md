# LLM Texture Strategy (Summary)

Note: If low-level tools are hidden, use texture_pipeline for the full workflow.

FacePaint flow:
- Use texture_pipeline with plan + facePaint to describe materials per cube/face.
- Automatic recovery re-plans UVs when overlap/scale issues occur.
- plan creates textures; avoid creating the same texture name again in textures/presets (use update or omit).

Primary flow:
1) assign_texture
2) preflight_texture
3) apply_uv_spec (or set_face_uv)
4) preflight_texture again
5) apply_texture_spec / generate_texture_preset
6) render_preview

Recovery loop:
- validate reports uv_scale_mismatch / uv_overlap, or a mutation returns invalid_state about overlap/scale/uvUsageId:
  - texture_pipeline (plan-based re-UV, auto-split, <=512, max 16 textures)
  - repaint

Tip: apply_texture_spec only returns guidance; use texture_pipeline to run the recovery loop once automatically.
Tip: texture_pipeline can run the full workflow (assign ??preflight ??uv ??paint ??preview) in one call.

Failure examples:

1) uvUsageId mismatch (invalid_state):
- Call preflight_texture WITHOUT texture filters.
- Retry apply_uv_spec/apply_texture_spec with the new uvUsageId.

2) UV overlap / UV scale mismatch (invalid_state):
- Run texture_pipeline (plan-based re-UV, auto-split, <=512, max 16 textures).
- Repaint using the refreshed mapping.

See full guide in docs/llm-texture-strategy.md.
