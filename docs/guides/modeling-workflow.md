# Modeling Workflow (ModelSpec)

Goal: define the desired model state and let model_pipeline plan/apply the changes.

Steps:
1) ensure_project (optional)
2) model_pipeline with desired bone/cube (or stages for complex models)
3) validate (optional) or preview (optional)
4) export (optional)

Minimal example:
```json
{
  "model": {
    "rigTemplate": "empty",
    "bone": { "id": "root", "pivot": [0,0,0] },
    "cube": { "id": "body", "parentId": "root", "from": [-4,0,-2], "to": [4,12,2] }
  },
  "mode": "replace",
  "preview": { "mode": "fixed", "output": "single", "angle": [30,45,0] },
  "validate": true,
  "ifRevision": { "$ref": { "kind": "tool", "tool": "get_project_state", "pointer": "/project/revision" } }
}
```

Staged example (skeleton -> body -> details):
```json
{
  "stages": [
    {
      "label": "root",
      "model": { "bone": { "id": "root", "pivot": [0,0,0] } }
    },
    {
      "label": "body",
      "model": {
        "bone": { "id": "body", "parentId": "root", "pivot": [0,6,0] },
        "cube": { "id": "body", "parentId": "body", "from": [-4,0,-2], "to": [4,12,2] }
      }
    },
    {
      "label": "details",
      "model": { "cube": { "id": "button", "parentId": "body", "from": [-1,10,2], "to": [1,12,3] } }
    }
  ],
  "preview": { "mode": "fixed", "output": "single", "angle": [30,45,0] },
  "ifRevision": { "$ref": { "kind": "tool", "tool": "get_project_state", "pointer": "/project/revision" } }
}
```

Notes:
- ModelSpec must include at least one of: bone, cube, or rigTemplate.
- rigTemplate is limited to single-part templates (empty or block_entity). For complex rigs (biped/quadruped), use stages with explicit bones/cubes.
- For stable edits, always use ids. If ids are omitted, the default idPolicy=stable_path derives ids from hierarchy/name; set idPolicy=explicit to enforce strict ids.
- Use mode=merge to add/update without deleting; mode=replace to match the desired state.
- deleteOrphans removes bones/cubes not in the spec (defaults to true when mode=replace).
- For large/complex objects, use `stages` to apply the model in parts (skeleton first, then major cubes, then details). Each stage is planned/applied sequentially in one call.
- `stagePreview` and `stageValidate` run preview/validate after each stage when preview/validate is set (defaults to true).
- Single-create mode: each stage must include at most one bone and one cube. Split bones/cubes across stages or calls.
- planOnly returns the plan without applying changes.
- Mutations require ifRevision; planOnly is read-only and can omit it.
- planOnly cannot be combined with ensureProject/preview/validate/export.
- Anchors let you reuse positions. Use pivotAnchorId on bones and centerAnchorId/originAnchorId on cubes.
- When enforceRoot=true (default), a root bone is auto-created if missing. If you include a "root" bone, avoid duplicates.
