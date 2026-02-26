# Ashfox

Blockbench MCP bridge plugin for low-level modeling, texturing, and animation.

## Showcase
![Ashfox prompt-only showcase](assets/ashfox-animation.gif)

This model, texture, and animation were created from prompts only in about 10 minutes.
Model used: GPT-5.2 (`extra high`).

## Who This Is For
- Creators using Blockbench Desktop
- MCP clients/agents that need deterministic, tool-level control

## Requirements
- Blockbench Desktop (latest stable)

## Install
### Option A (recommended): Load from release URL
In Blockbench Desktop:
1. Open `File > Plugins > Load Plugin from URL`
2. Paste:

```text
https://github.com/sigee-min/ashfox/releases/latest/download/ashfox.js
```

3. Click install/load

### Option B: Build locally
```bash
git clone https://github.com/sigee-min/ashfox.git
cd ashfox
npm install
npm run build
```

Then load `dist/ashfox.js` in Blockbench Plugin Manager.

## Default Endpoint
```text
http://127.0.0.1:8787/mcp
```

## First Connection Check
```bash
curl -s http://127.0.0.1:8787/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## First Capability Check
```bash
curl -s http://127.0.0.1:8787/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_capabilities","arguments":{}}}'
```

## Recommended Usage Flow
1. `ensure_project` (or `get_project_state`) to get current revision
2. Run mutating tools with `ifRevision`
3. `validate`
4. `render_preview`
5. `export`

## What Ashfox Exposes
- Modeling: `add_bone`, `add_cube`, `add_mesh`, updates/deletes
- Texturing: `assign_texture`, `paint_faces`, `paint_mesh_face`, `read_texture`
- Animation: `create_animation_clip`, `set_frame_pose`, `set_trigger_keyframes`
- Project/ops: `ensure_project`, `get_project_state`, `validate`, `render_preview`, `export`

## Common Problems
- Plugin fails to load from URL:
  - Make sure you are loading `ashfox.js` (not old filenames).
- MCP client cannot connect:
  - Verify Blockbench plugin is loaded and endpoint is exactly `127.0.0.1:8787/mcp`.
- Revision mismatch errors:
  - Re-read state with `get_project_state` and retry with latest `ifRevision`.

## Security
Use only local/trusted MCP clients against your Blockbench session.

## License
MIT. See `LICENSE`.
