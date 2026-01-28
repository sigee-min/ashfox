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
    "bones": [{ "id": "root", "pivot": [0, 0, 0] }]
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
    "bones": [{ "id": "root", "pivot": [0, 0, 0] }]
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

## Notes
- Only GeckoLib is implemented (`format: geckolib`).
- If textures are included, supply `uvUsageId` (or use `autoRecover=true` to run a single recovery).
- `cleanup` deletes explicitly listed textures; when `force=false` (default), deletion fails if textures are still assigned to cubes.
- Model changes use the same ModelSpec semantics as `model_pipeline` (merge by default).
- If `planOnly=true` or the payload is underspecified, the pipeline skips mutations and emits short `ask_user` prompts via `nextActions`.

## Output (structuredContent)
- `applied: boolean` (false when planOnly)
- `planOnly: true` when mutations are skipped
- `format`, `targetVersion`
- `steps.model`, `steps.textures`, `steps.animations` when executed
