# Troubleshooting

## The agent cannot connect

Use an agent that can control a browser and keep Workbench open. Have it fetch
`agent-manifest.json` from that Workbench. For local development, use the local
manifest too.

## A change is rejected

Ask the agent to read the reported issue and fix it. If the message says the
project is stale, have it read the current project before trying again. A
rejected change leaves the previous workspace in place.

## The model looks wrong

Describe the visible problem and when it happens. The agent can revise the
model and review it again. See [Create and refine](authoring-and-review.md).

## Export is blocked

Read the issue shown in Export. Ask the agent to complete the missing review
or fix the model. If your target does not support a feature you need, check
[Export formats](choose-a-format.md).

## Recover a project

Open your downloaded `.ashfoxworkspace`. Keep the original if it cannot be
opened; incompatible older files are not migrated automatically. Exported
models and replay GIFs do not replace an editable workspace backup.

For API errors and source diagnostics, agents can use the
[workflow reference](agent-workflow.md#failure-routing).
