# Rigging Guide (Animation-Ready)

Use a root-based hierarchy so animation transforms propagate predictably.

Guidelines:
- Ensure a root bone exists. For Java Block/Item with enforceRoot=true, omit explicit "root" to avoid duplicates.
- Every non-root part must set parent to an existing bone.
- Avoid flat bone lists (no parents). Use a tree: root -> body -> head/limbs.
- Prefer model_pipeline for all modeling edits.

Example (model_pipeline):
```json
{
  "stages": [
    { "label": "root", "model": { "rigTemplate": "empty", "bone": { "id": "root", "pivot": [0, 0, 0] } } },
    { "label": "body", "model": { "bone": { "id": "body", "parentId": "root", "pivot": [0, 6, 0] } } },
    { "label": "head", "model": { "bone": { "id": "head", "parentId": "body", "pivot": [0, 12, 0] } } },
    { "label": "left_arm", "model": { "bone": { "id": "left_arm", "parentId": "body", "pivot": [4, 12, 0] } } },
    { "label": "right_arm", "model": { "bone": { "id": "right_arm", "parentId": "body", "pivot": [-4, 12, 0] } } }
  ],
  "mode": "merge"
}
```

Common failures and fixes:
- "Parent bone not found": ensure the parent part exists and that every non-root part sets a valid parent id. If unsure, rebuild the hierarchy using model_pipeline (mode=replace).
- "invalid_state_revision_mismatch": call get_project_state and retry with the latest ifRevision.
