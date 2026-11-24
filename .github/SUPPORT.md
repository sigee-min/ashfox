# Support

## Get help

Start with the [user guides](https://ashfox.io/docs/) and search
[existing issues](https://github.com/sigee-min/ashfox/issues).

Open a GitHub issue for:

- bug reports
- feature requests
- documentation clarifications

## Web studio issues

Include:

- ashfox version or commit;
- browser and operating system;
- export target: GeckoLib 5, Bedrock, GLB, or glTF;
- minimal reproduction steps;
- expected and actual results;
- the shortest safe error message or screenshot that explains the problem.

Do not attach private projects publicly. Create a minimal
`.ashfoxworkspace` reproduction only when it contains no sensitive assets.

## Blockbench MCP issues

Include:

- ashfox plugin version or commit;
- Blockbench version and model format;
- MCP client name;
- the endpoint shown by the plugin;
- minimal reproduction steps and relevant Blockbench console output.

Before opening an issue:

1. In Blockbench settings (`ashfox: Server`), set `MCP Host`, `MCP Port`, `MCP Path`.
2. Reload the plugin and check the runtime status signal:
   - `ashfox MCP inline: <host>:<port><path>` or
   - `ashfox MCP sidecar: <host>:<port><path>`
3. Test the exact endpoint from the status signal with `tools/list`.

## Security issues

Do not open public issues for vulnerabilities.
Follow [SECURITY.md](SECURITY.md).
