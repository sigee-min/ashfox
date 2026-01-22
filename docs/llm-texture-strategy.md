# LLM Texture Strategy (bbmcp)

Use this guide to keep UVs and textures consistent across parts.

## Primary Workflow
1) `assign_texture`
2) `preflight_texture`
3) `apply_uv_spec` (or `set_face_uv`)
4) `preflight_texture` again
5) `apply_texture_spec` or `generate_texture_preset`
6) `render_preview`

## Error Recovery (Always)
If you see `uv_scale_mismatch` or `uv_overlap`:
1) `auto_uv_atlas` with `apply=true`
2) `preflight_texture` again (new `uvUsageId`)
3) Repaint with `apply_texture_spec` or `generate_texture_preset`

## Common Pitfalls
- All faces mapped to full texture (e.g., [0,0,32,32]) causes scale mismatch.
- Changing textureResolution after painting requires repainting.
- UV overlap is only allowed if rectangles are identical.

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
  "uvUsageId": "<from preflight_texture>",
  "mode": "create"
}
```
