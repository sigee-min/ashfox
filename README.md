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
- If you export/use `geckolib` models: add GeckoLib dependency in your target mod project.
  - Ashfox does not bundle GeckoLib runtime/library.
  - Ensure the `geckolib` format is enabled in Blockbench/Ashfox capabilities.

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

## OS Permission Checklist (First Run)
### macOS
1. If Blockbench shows:
   - `"The plugin \"ashfox\" requires permission to see information about your computer."`
   - `"Filesystem access required"`
   approve it for the `ashfox` plugin.
2. If macOS system permission prompts appear for folders, approve `Blockbench` for the folders you use (for example `Desktop`, `Documents`, `Downloads`).

### Windows
1. If Windows Defender Firewall prompts for Blockbench, allow it on Private networks (Ashfox uses local `127.0.0.1` MCP).
2. If Controlled Folder Access blocks save/export, allow Blockbench in Windows Security.

### Linux
1. If using sandboxed installs (Flatpak/Snap), grant filesystem access for your project/export paths.
2. Ensure localhost access (`127.0.0.1`) is not blocked by sandbox/firewall policy.

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
- Port/host/path settings reset after reload:
  - Change settings in `ashfox: Server` (`MCP Host`, `MCP Port`, `MCP Path`), then reload plugin.
  - Verify the status popup/log: `ashfox MCP inline|sidecar: <host>:<port><path>`.
  - If values still reset, capture Blockbench console logs and open an issue.
- MCP client cannot connect:
  - Verify Blockbench plugin is loaded and status shows `ashfox MCP inline: ...` or `ashfox MCP sidecar: ...`.
  - Re-run `tools/list` against the endpoint shown in the status message.
- Revision mismatch errors:
  - Re-read state with `get_project_state` and retry with latest `ifRevision`.

## Security
Use only local/trusted MCP clients against your Blockbench session.

## License
MIT. See `LICENSE`.
