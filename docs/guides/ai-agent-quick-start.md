# Get started

Ashfox persists one closed asset workspace. The workspace contains exact
`ashfox-model 1` source modules, package manifests, and an exact lock. The Web
Studio is an observation, review, and delivery surface; generated scene data is
not editable authority.

## Connect

1. Open [ashfox.io Workbench](https://ashfox.io/workbench/) and create or open a project.
2. Give the connected agent this instruction:

~~~text
Fetch and follow https://ashfox.io/workbench/agent-manifest.json using a direct HTTP request such as curl.
Use https://ashfox.io/workbench/ as the working browser tab and inspect the current project.
Follow the task below; ask what to create or change only if I have not supplied it.
~~~

3. Append the requested outcome. Describe the subject, scale, silhouette,
   palette, and motion as needed; you do not need to specify compiler details.

For example, when refining an existing asset:

~~~text
Make the head wider while preserving the current block silhouette, warm palette,
and expression. Keep the eye marks the same pixel size. Check linked chart sizes,
measure the rebuilt result, and review the actual rendered views before finishing.
~~~

For a read-only task, say “inspect and explain; do not change the workspace.”
The installed `$ashfox` skill provides the same connection workflow. A local
Workbench is only for an explicitly selected development environment; use its
own manifest rather than mixing it with the ashfox.io contract.

The agent first inspects the active workspace summary. It reads exact bounded
source ranges only when needed, prepares one complete workspace change set,
and submits the sole mutation command, `workspace.apply`, with the current
workspace-hash compare-and-swap guard and an explicit selected entry.
The engine reseals local package locks; the agent never submits `changes.lock`.
See [Agent workflow](agent-workflow.md) for the complete executable API sequence.

The change is atomic. Every declared entry must compile to a valid product;
declared modules must be reachable and checked through entry closures. A stale hash, orphan module,
invalid lock, or failed entry leaves the existing workspace unchanged.

## Organize reuse

- Share exact dimensions, construction datums, and checks through `design` fields.
- Put shared nominal rig contracts, skeletons, and motions in a rig module.
- Put chart/material ABIs and concrete deterministic texture programs in
  surface modules.
- Put reusable lexical geometry behind typed component ports.
- Keep entry files small: import modules, choose a skeleton, bind components
  and surfaces, connect sockets, and select motions.

Open the checked-in
[`shared-creatures.ashfoxworkspace`](../../examples/shared-creatures.ashfoxworkspace)
to see two entries reusing one rig, motion, component, and surface library.

For linked geometry/chart dimensions and fixed-size pixel marks, follow
[Precision modeling](precision-modeling.md). The agent can discover nodes,
measure relevant rest-pose geometry and UV evidence, change source, and inspect
the rebuilt product using fresh revision/workspace/build guards. These reads
support—not replace—rendered review.

## Review and deliver

Review perspective, gameplay/native, front, side, and top views, then each
motion cycle. Mechanical validation proves deterministic correctness, not
visual quality. A rejection must lead to a new workspace source change; never
patch a rendered scene or canonical texture.

After review, Build replay reconstructs the current entry from empty scene to
finished product. Export then recompiles the exact selected entry, verifies its
workspace/closure/build/product lineage, and runs the chosen target validator.
