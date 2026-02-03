# Entity Pipeline (bbmcp)

## Goal
Apply model + textures + animations for GeckoLib entities in one MCP call.

## Tool
`entity_pipeline`

### Minimal request
```json
{
  "format": "geckolib",
  "model": {
    "rigTemplate": "empty",
    "bone": { "id": "root", "pivot": [0, 0, 0] }
  }
}
```

### With ensureProject + animations
```json
{
  "format": "geckolib",
  "targetVersion": "v4",
  "ensureProject": { "name": "my_entity", "match": "format", "onMissing": "create" },
  "model": {
    "rigTemplate": "empty",
    "bone": { "id": "root", "pivot": [0, 0, 0] }
  },
  "animations": [
    {
      "name": "idle",
      "length": 1,
      "loop": true,
      "channels": [
        { "bone": "root", "channel": "rot", "keys": [{ "time": 0, "value": [0, 0, 0] }] }
      ]
    }
  ],
  "ifRevision": { "$ref": { "kind": "tool", "tool": "get_project_state", "pointer": "/project/revision" } }
}
```

### With texturePlan (auto textures + UV bootstrap)
```json
{
  "format": "geckolib",
  "targetVersion": "v4",
  "ensureProject": { "name": "my_entity", "match": "format", "onMissing": "create" },
  "model": {
    "rigTemplate": "empty",
    "bone": { "id": "root", "pivot": [0, 0, 0] }
  },
  "texturePlan": {
    "name": "tractor",
    "detail": "high",
    "maxTextures": 1,
    "resolution": { "width": 256, "height": 256 },
    "paint": { "preset": "painted_metal" }
  }
}
```

### With facePaint (materials on faces)
```json
{
  "format": "geckolib",
  "targetVersion": "v4",
  "ensureProject": { "name": "my_entity", "match": "format", "onMissing": "create" },
  "texturePlan": { "name": "tractor", "detail": "high", "maxTextures": 1 },
  "facePaint": [
    { "material": "metal", "cubeNames": ["body"], "faces": ["north", "south"] },
    { "material": "rubber", "cubeNames": ["wheel_left", "wheel_right"] }
  ]
}
```

## Notes
- Only GeckoLib is implemented (`format: geckolib`).
- If textures/facePaint are included, `uvUsageId` is optional. The pipeline will preflight + auto-plan UVs when missing.
- If UV overlap/scale issues or missing UVs are detected, the pipeline runs an implicit `texturePlan` (auto-split, <=512, max 16 textures) before painting.
- `texturePlan` creates textures, assigns them, applies UVs, and optionally paints presets (no manual preflight required).
- For complex models, use `modelStages` to apply bones/cubes in parts (e.g., skeleton → body → details).
- `stagePreview` and `stageValidate` run preview/validate after each stage when preview/validate is set (defaults to true).
- `mode`/`deleteOrphans` apply as defaults for modelStages; for single model payloads they control the single stage.
- `cleanup` deletes explicitly listed textures; when `force=false` (default), deletion fails if textures are still assigned to cubes.
- Model changes use the same ModelSpec semantics as `model_pipeline` (merge by default).
- If `planOnly=true` or the payload is underspecified, the pipeline skips mutations and emits short `ask_user` prompts via `nextActions`.
- `facePaint` cannot be combined with `planOnly=true`; run facePaint in a follow-up call after planning.
- `autoStage` (default true) stages texture planning/UV/painting with a preflight refresh before painting.
- `preview` and `validate` behave like `model_pipeline` and run after the full pipeline; preview also attaches the image payload.
- Single-create mode: each stage must include at most one bone and one cube. Split bones/cubes across stages or calls.

## Output (structuredContent)
- `applied: boolean` (false when planOnly)
- `planOnly: true` when mutations are skipped
- `format`, `targetVersion`
- `steps.texturePlan` when auto-planning textures/UVs
- `steps.textures`, `steps.presets`, `steps.animations` when executed
