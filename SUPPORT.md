# Support

## Get Help
Use GitHub Issues for:
- bug reports
- feature requests
- documentation clarifications

When reporting issues, include:
- ashfox version/commit
- Blockbench version
- model format (for example `java_block`, `geckolib`, `animated_java`)
- exact request payload and response (if relevant)
- minimal reproduction steps

## Before Opening an Issue
- Read `README.md`
- Search existing issues for duplicates

## MCP Endpoint Troubleshooting
1. In Blockbench settings (`ashfox: Server`), set `MCP Host`, `MCP Port`, `MCP Path`.
2. Reload the plugin and check the runtime status signal:
   - `ashfox MCP inline: <host>:<port><path>` or
   - `ashfox MCP sidecar: <host>:<port><path>`
3. Test the exact endpoint from the status signal with `tools/list`.
4. If reload reverts settings or server is not reachable, include:
   - status message text
   - Blockbench console logs around reload/startup
   - host/port/path values you set

## Security Issues
Do not open public issues for vulnerabilities.
Follow `SECURITY.md`.
