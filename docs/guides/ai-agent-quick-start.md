# Get started

Ashfox needs a browser-capable AI agent. The agent keeps the Workbench open,
reads the current project, makes source changes, and presents the result for
review. A chat-only agent cannot complete this workflow.

## Connect

1. Open the [Ashfox Workbench](https://ashfox.io/workbench/) and create or
   open a project.
2. Give the connected agent this instruction:

~~~text
Fetch and follow https://ashfox.io/workbench/agent-manifest.json using a direct HTTP request such as curl.
~~~

3. Add what you want to create or change. Describe the subject, silhouette,
   proportions, palette, pixel density, attachments, and motion when they
   matter. Say what to preserve when refining an existing asset.

For example:

~~~text
Make the head wider while preserving the current block silhouette, warm palette,
and expression. Keep the eye marks the same pixel size. Review the rebuilt result
before finishing.
~~~

For a read-only task, say: “Inspect and explain; do not change the workspace.”

Keep the Workbench available in the browser while the agent works. If you use a
local development Workbench, fetch the manifest from that same origin.

## What happens next

The agent inspects the active workspace, reads only the source it needs,
previews a complete change, and applies it after validation. It then refreshes
the project, reviews the rendered views and motion, and creates Build replay
evidence after the reviews pass. Export is an optional final step.

The Workbench is for viewing, reviewing, saving, and exporting. Make authoring
changes through the agent so the workspace remains the source for the asset.
For the full browser API sequence, see [Agent workflow](agent-workflow.md).
