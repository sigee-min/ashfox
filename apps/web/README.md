# ashfox Web Studio

The browser Workbench for viewing, reviewing, saving, and exporting assets
created by an AI agent.

From the repository root:

```bash
npm install
npm run dev:web
```

## Agent integration

Fetch `/workbench/agent-manifest.json` from the connected Workbench. It is
generated from `src/features/agent/agentManifest.ts` and links to matching
workflow and language references.

The public API discovers and reads workspace files, validates candidate edits,
presents previews, applies source changes with engine-managed locks, and
tracks rendered reviews before Build replay capture. Use `data.nextActions`
and `data.workflow` to continue from the current state.

See [Agent workflow](../../docs/guides/agent-workflow.md) for request examples
and the DOM transport for browser tools without page JavaScript evaluation.

## Development

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for checks,
[the codebase map](../../docs/architecture/codebase.md) for ownership, and
[the development manifest](../../development-manifest.json) for repository rules.

`npm run test:web:browser` exercises the complete public agent workflow in a
real browser. Use `-- --manual` to observe and judge the rendered reviews.
