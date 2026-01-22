import { ResourceContent, ResourceTemplate } from '../ports/resources';

export const GUIDE_RESOURCE_TEMPLATES: ResourceTemplate[] = [
  {
    uriTemplate: 'bbmcp://guide/{name}',
    name: 'Guide',
    mimeType: 'text/markdown',
    description: 'Static guides and examples for bbmcp workflows.'
  }
];

export const GUIDE_RESOURCES: ResourceContent[] = [
  {
    uri: 'bbmcp://guide/rigging',
    name: 'Rigging Guide',
    mimeType: 'text/markdown',
    description: 'Root-based bone hierarchy guidelines for animation-ready rigs.',
    text: `# Rigging Guide (Animation-Ready)

Use a root-based hierarchy so animation transforms propagate predictably.

Guidelines:
- Always include a root bone named "root".
- Every non-root part must set parent to an existing bone.
- Avoid flat bone lists (no parents). Use a tree: root -> body -> head/limbs.
- Prefer apply_model_spec or apply_rig_template over low-level add_bone/add_cube.

Example (apply_model_spec):
\`\`\`json
{
  "model": {
    "rigTemplate": "empty",
    "parts": [
      { "id": "root", "size": [0, 0, 0], "offset": [0, 0, 0] },
      { "id": "body", "parent": "root", "size": [8, 12, 4], "offset": [-4, 0, -2] },
      { "id": "head", "parent": "body", "size": [8, 8, 8], "offset": [-4, 12, -4] },
      { "id": "left_arm", "parent": "body", "size": [4, 12, 4], "offset": [4, 12, -2] },
      { "id": "right_arm", "parent": "body", "size": [4, 12, 4], "offset": [-8, 12, -2] }
    ]
  }
}
\`\`\`

Low-level add_bone:
- Always set parent for non-root bones.
- Keep names stable so animation channels remain valid.
`
  },
  {
    uri: 'bbmcp://guide/texture-workflow',
    name: 'Texture Workflow Guide',
    mimeType: 'text/markdown',
    description: 'UV-first texture workflow with uvPaint and presets.',
    text: `# Texture Workflow (UV-first)

Goal: paint only within UV rects so patterns scale correctly.

Steps:
1) ensure_project / get_project_state (capture revision)
2) assign_texture (bind texture to cubes)
3) preflight_texture (get uvUsageId + mapping)
4) apply_uv_spec (high-level UV updates) OR set_face_uv (low-level)
5) preflight_texture again (UVs changed → new uvUsageId)
6) apply_texture_spec or generate_texture_preset using uvUsageId
7) render_preview to validate

Notes:
- uvPaint is enforced; only UV rects are painted.
- If UVs change, preflight again and repaint.
- For >=64px textures, use generate_texture_preset.

Example (generate_texture_preset):
\`\`\`json
{
  "preset": "wood",
  "name": "pot_wood",
  "width": 64,
  "height": 64,
  "uvUsageId": "<from preflight_texture>",
  "mode": "create"
}
\`\`\`
`
  },
  {
    uri: 'bbmcp://guide/uv-atlas',
    name: 'UV Atlas Guide',
    mimeType: 'text/markdown',
    description: 'Auto atlas packing and resolution growth strategy.',
    text: `# UV Atlas Guide

Use auto_uv_atlas when UVs overlap or there is not enough space.

Key points:
- Only identical rects may overlap.
- auto_uv_atlas groups by texture + face size.
- When packing overflows, resolution doubles and packing retries.
- Rect sizes are computed from the starting resolution; increasing size adds space instead of scaling UVs.

Example (plan only):
\`\`\`json
{
  "apply": false
}
\`\`\`

Example (apply):
\`\`\`json
{
  "apply": true
}
\`\`\`

After apply:
- Call preflight_texture again.
- Repaint textures using the new mapping.
`
  },
  {
    uri: 'bbmcp://guide/texture-spec',
    name: 'Texture + UV Spec',
    mimeType: 'text/markdown',
    description: 'Canonical UV and texturing invariants.',
    text: `# Texture + UV Spec (Summary)

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
- auto_uv_atlas when UVs are crowded

See full spec in docs/texture-uv-spec.md.
`
  },
  {
    uri: 'bbmcp://guide/llm-texture-strategy',
    name: 'LLM Texture Strategy',
    mimeType: 'text/markdown',
    description: 'LLM-oriented workflow and recovery loop.',
    text: `# LLM Texture Strategy (Summary)

Primary flow:
1) assign_texture
2) preflight_texture
3) apply_uv_spec (or set_face_uv)
4) preflight_texture again
5) apply_texture_spec / generate_texture_preset
6) render_preview

Recovery loop:
uv_scale_mismatch / uv_overlap
→ auto_uv_atlas (apply=true)
→ preflight_texture
→ repaint

See full guide in docs/llm-texture-strategy.md.
`
  },
  {
    uri: 'bbmcp://guide/vision-fallback',
    name: 'Vision Fallback Guide',
    mimeType: 'text/markdown',
    description: 'Preview/texture image snapshot workflow for manual uploads.',
    text: `# Vision Fallback (Preview + Texture)

Primary: use render_preview / read_texture so the client can attach images directly.

Fallback: if the client cannot accept images, save snapshots to disk and upload manually.

Preview (auto + fallback):
\`\`\`json
{
  "mode": "fixed",
  "output": "single",
  "angle": [30, 45, 0],
  "saveToTmp": true,
  "tmpPrefix": "preview"
}
\`\`\`

Texture (auto + fallback):
\`\`\`json
{
  "name": "pot_wood",
  "saveToTmp": true,
  "tmpPrefix": "texture"
}
\`\`\`

Snapshots are saved under:
- <project_root>/.bbmcp/tmp

Cleanup:
- Delete files immediately after manual upload to avoid stale/large tmp files.
`
  },
  {
    uri: 'bbmcp://guide/entity-workflow',
    name: 'Entity Workflow Guide',
    mimeType: 'text/markdown',
    description: 'GeckoLib-first entity workflow with version targeting.',
    text: `# Entity Workflow (GeckoLib-first)

This workflow prioritizes GeckoLib, with Modded/OptiFine formats as TODO.

Recommended steps:
1) apply_entity_spec with format=geckolib (targetVersion v3/v4)
2) include model parts (root-based hierarchy)
3) include textures + uvUsageId if painting
4) include animations (clips + keyframes)
5) add triggers (sound/particle/timeline) if needed

Example:
\`\`\`json
{
  "format": "geckolib",
  "targetVersion": "v4",
  "ensureProject": { "name": "my_entity", "match": "format", "onMissing": "create" },
  "model": {
    "rigTemplate": "empty",
    "parts": [
      { "id": "root", "size": [0,0,0], "offset": [0,0,0] },
      { "id": "body", "parent": "root", "size": [8,12,4], "offset": [-4,0,-2] }
    ]
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
\`\`\`
`
  }
];
