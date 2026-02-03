# Entity Workflow (GeckoLib-first)

This workflow prioritizes GeckoLib; Modded/OptiFine formats are not covered yet.

Recommended steps:
1) entity_pipeline with format=geckolib (targetVersion v3/v4)
2) include model bone/cube (root-based hierarchy) or use modelStages for stepwise builds
3) for staged builds, split across modelStages for stepwise builds
4) include texturePlan (auto textures + UV) plus facePaint, or textures + uvUsageId if painting
5) include animations (clips + keyframes)
6) add triggers (sound/particle/timeline) if needed
7) optionally run preview/validate; use stagePreview/stageValidate to run after each stage

Example:
```json
{
  "format": "geckolib",
  "targetVersion": "v4",
  "ensureProject": { "name": "my_entity", "match": "format", "onMissing": "create" },
  "model": {
    "rigTemplate": "empty",
    "bone": { "id": "root", "pivot": [0, 0, 0] },
    "cube": { "id": "body", "parentId": "root", "from": [-4, 0, -2], "to": [4, 12, 2] }
  },
  "texturePlan": {
    "name": "my_entity",
    "detail": "medium",
    "maxTextures": 1,
    "resolution": { "width": 128, "height": 128 },
    "paint": { "preset": "painted_metal" }
  },
  "textures": [],
  "animations": [
    {
      "name": "idle",
      "length": 1.5,
      "loop": true,
      "fps": 20,
      "channels": [
        {
          "bone": "body",
          "channel": "rot",
          "keys": [{ "time": 0, "value": [0, 0, 0] }]
        }
      ],
      "triggers": [
        { "type": "sound", "keys": [{ "time": 0.5, "value": "my_mod:entity.idle" }] }
      ]
    }
  ]
}
```

Notes:
- modelStages applies bones/cubes in sequence (skeleton -> body -> details).
- mode/deleteOrphans act as defaults for stages; for single model payloads they control the single stage.
- stagePreview/stageValidate run preview/validate after each stage when preview/validate is set.
- Single-create mode: each stage must include at most one bone and one cube. Split bones/cubes across stages or calls.
- facePaint cannot be combined with planOnly; run facePaint after planning.
- Unknown facePaint materials return an error; use supported keywords or provide palettes.
- autoStage (default true) stages texture planning/UV/painting with a preflight refresh before painting.
