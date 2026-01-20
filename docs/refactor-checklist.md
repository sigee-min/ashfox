# Refactor Guardrails

## Invariants
- Tool schemas and error codes stay stable.
- `ifRevision` behavior stays unchanged.
- `ToolResponse` structure stays unchanged.
- MCP server still responds on the configured host/port/path.

## Manual Verification
- `list_capabilities` returns expected version and limits.
- `create_project(ifRevision)` succeeds.
- `add_bone` and `add_cube` succeed.
- `preflight_texture` returns UV bounds and a recommended resolution when UVs exceed the current size.
- `apply_texture_spec` updates state and revision.
- `assign_texture` binds textures to cubes without changing UVs.
- `set_face_uv` updates per-face UVs as provided.
- `render_preview` returns content output.
- `export` writes a file when path is writable.
