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
3) set_face_uv (manual per-face UVs)
4) preflight_texture (get uvUsageId + mapping)
5) apply_texture_spec or generate_texture_preset using uvUsageId
6) render_preview to validate

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
  }
];
