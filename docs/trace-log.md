# Trace Log (NDJSON)

The plugin records tool + proxy calls into a **trace log** so you can replay or diff
real Blockbench behavior against the simulator.

## What's inside
- One record per line (NDJSON)
- Records include:
  - tool/proxy name
  - payload (sanitized)
  - response (sanitized)
  - project state summary
  - project diff summary (when revision changes)

## Where it's stored
- **In-memory resources** (default, can be disabled):
  - `bbmcp://logs/trace.ndjson` (raw log)
  - `bbmcp://logs/trace-report.json` (auto-generated summary)
- **On desktop**: written via `writeFile` in real time when possible
  - default path (when filesystem access is available):
    - Windows: `%APPDATA%/bbmcp/trace/bbmcp-trace.ndjson`
    - Linux/macOS: `~/.bbmcp/trace/bbmcp-trace.ndjson` (or `$XDG_CONFIG_HOME/bbmcp/trace/...`)
  - if the directory cannot be resolved, falls back to project save/export path
  - export dialog is reserved for explicit export (tool/menu)

## Export
- MCP tool: `export_trace_log`
 
## Notes
- Trace log max size is fixed in plugin defaults (2048 KB) unless changed in code.

## Replay
Use `parseTraceLogText` + `stepsFromTraceLog` to replay via `runTrace`.

