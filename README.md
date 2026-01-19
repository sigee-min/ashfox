# bbmcp

Blockbench, but programmable.  
bbmcp turns Blockbench into an MCP-native modeling backend with a clean tool surface for AI/agents and scripts.

## Highlights
- MCP-first HTTP server with tool discovery and schema versioning.
- High-level spec tools (`apply_model_spec`, `apply_texture_spec`, `apply_project_spec`).
- Low-level controls (bones, cubes, textures, animations, export, validate).
- Explicit texture assignment via `assign_texture` (no hidden auto-assign).
- Revision guard (`ifRevision`) for safe concurrent edits.
- Preview output as MCP `content` image blocks (base64 PNG).
- Vanilla enabled by default; GeckoLib/Animated Java gated by capabilities.

## Quickstart
1) Install dependencies
```bash
npm install
```

2) Build
```bash
npm run build
```

3) Load the plugin in Blockbench
- Blockbench desktop only.
- Use the plugin manager or load `dist/bbmcp.js` manually.

4) Start MCP
- The plugin starts an MCP server on `127.0.0.1:8787/mcp` by default.
- Configure host/port/path in `Settings > bbmcp` or via the Help menu action.

## Default Endpoint
```
http://127.0.0.1:8787/mcp
```

## Core Flow (Recommended)
1) `get_project_state` to read `revision`.
2) Mutations (`create_project`, `add_bone`, `add_cube`, `apply_*`) with `ifRevision`.
3) `validate` to catch issues early.
4) `render_preview` for images.
5) `export` for JSON output.

## Texture Flow (Recommended)
1) `apply_texture_spec` to create or update texture data via ops (no image import tool).
   - Omit `ops` to create an empty texture (background can still fill).
   - `width/height` are required and should match the project textureResolution.
2) `assign_texture` to bind textures to cubes (required for visible results; does not change UVs).
3) `set_face_uv` to apply per-face UVs explicitly.
4) Prefer material-group textures (pot/soil/plant) and assign via `cubeNames` for stability.
5) If UVs exceed the current resolution, increase it or split textures per material.
6) Size textures to fit the UV layout (width >= 2*(w+d), height >= 2*(h+d)) and round up to 32/64/128; use `set_project_texture_resolution` before creating textures. If you need to scale existing UVs, pass `modifyUv=true` (if supported by the host).

## Preview Output (MCP Standard)
`render_preview` responds with MCP `content` blocks:
```json
{
  "content": [
    {
      "type": "image",
      "mimeType": "image/png",
      "data": "<base64>"
    }
  ],
  "meta": {
    "kind": "single",
    "width": 766,
    "height": 810,
    "byteLength": 67336
  }
}
```

## Sidecar (Optional)
The plugin prefers an inline server. If unavailable, it can spawn a sidecar.
- Output: `dist/bbmcp-sidecar.js`
- Configure `execPath` in Settings to point to `node` if needed.

## Notes
- The plugin is designed for the latest Blockbench desktop build.
- Tool schemas are strict; use `list_capabilities` and tool definitions as the source of truth.

## License
See `LICENSE`.
