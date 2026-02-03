# Texture Workflow (UV-first)

Goal: paint only within UV rects so patterns scale correctly.

Note: If low-level tools are not exposed, use texture_pipeline to run the whole flow.

Steps:
1) ensure_project / get_project_state (capture revision)
2) assign_texture (bind texture to cubes)
3) preflight_texture (get uvUsageId + mapping)
4) apply_uv_spec (high-level UV updates) OR set_face_uv (low-level)
5) preflight_texture again (UVs changed ??new uvUsageId)
6) apply_texture_spec or generate_texture_preset using uvUsageId
7) render_preview to validate

Notes:
- uvPaint is enforced; only UV rects are painted.
- Small or highly non-square UV rects can make `uvPaint.mapping:"stretch"` look distorted. Consider `mapping:"tile"`, a higher texture resolution (32/64), or re-pack UVs.
- If you see uv_scale_mismatch, your UVs are too small for the model at the current resolution. Increase resolution (64+), reduce cube count, or allow split textures.
- Automatic recovery may raise texture resolution to resolve uv_scale_mismatch.
- Call preflight_texture without texture filters for a stable uvUsageId.
- If UVs change, preflight again and repaint.
- For >=64px textures, use generate_texture_preset.
- plan creates textures; do not create the same name again. Use mode:"update" with targetName (or omit textures).
- If a texture update returns no_change, the rendered output matched the existing pixels. Change ops/colors or rename the texture to force an update.
- If you set plan.resolution and want a single atlas, set allowSplit:false or maxTextures:1.
- When specifying both cubeIds and cubeNames in targets, both must match. Use only one to avoid overly narrow matches.
- Unknown facePaint materials return an error; use supported keywords or provide palettes.
- For formats with perTextureUvSize, ensure per-texture width/height exist (or pass a resolution override) before facePaint.
- `autoStage` (default true) stages plan/UV/paint steps with a preflight refresh before painting.

FacePaint (material-first):
```json
{
  "plan": { "name": "tractor", "detail": "high", "maxTextures": 1 },
  "facePaint": [
    { "material": "metal", "cubeNames": ["body"] },
    { "material": "rubber", "cubeNames": ["wheel_left", "wheel_right"] }
  ]
}
```

Example (generate_texture_preset):
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

Example (preflight_texture):
```json
{
  "includeUsage": true
}
```

Example (apply_uv_spec):
```json
{
  "uvUsageId": { "$ref": { "kind": "tool", "tool": "preflight_texture", "pointer": "/uvUsageId" } },
  "assignments": [
    {
      "cubeName": "body",
      "faces": {
        "north": [0, 0, 8, 12],
        "south": [8, 0, 16, 12]
      }
    }
  ],
  "ifRevision": { "$ref": { "kind": "tool", "tool": "get_project_state", "pointer": "/project/revision" } }
}
```

Example (apply_texture_spec, minimal create):
```json
{
  "uvUsageId": { "$ref": { "kind": "tool", "tool": "preflight_texture", "pointer": "/uvUsageId" } },
  "textures": [
    {
      "mode": "create",
      "name": "pot_wood",
      "width": 64,
      "height": 64,
      "background": "#00000000",
      "uvPaint": { "scope": "rects", "mapping": "stretch" },
      "ops": []
    }
  ],
  "ifRevision": { "$ref": { "kind": "tool", "tool": "get_project_state", "pointer": "/project/revision" } }
}
```

Example (texture_pipeline, minimal):
```json
{
  "preflight": { "includeUsage": false },
  "textures": [
    { "mode": "create", "name": "pot_wood", "width": 64, "height": 64, "background": "#00000000" }
  ],
  "preview": { "mode": "fixed", "output": "single", "angle": [30, 45, 0] },
  "ifRevision": { "$ref": { "kind": "tool", "tool": "get_project_state", "pointer": "/project/revision" } }
}
```
