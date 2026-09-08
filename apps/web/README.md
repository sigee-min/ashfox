# ashfox Web Studio

Zero-install, browser-local observation and delivery surface for explicit
`ashfox-model 1` assets.

Current scope:

- canonical `ProjectDocument` live preview;
- Three.js WebGL2 viewport with orbit, camera presets, and environments;
- IndexedDB persistence of the exact authored workspace, selected entry, and
  host project identity;
- human-operated project, download, export, and capture boundaries;
- compiler validation, derived textures, and motion playback;
- deterministic local build-replay GIF capture that starts from an empty scene,
  places every visible element in deterministic canonical element order, applies
  each element's complete owning texture set atomically, activates canonical
  authored idle motion when available, and holds on the complete model;
- atomic workspace replacement through the Agent Command Port;
- revision/workspace/build-bound node, rest-pose measurement, and face UV reads;
- static production build with no application server routes.

Run locally:

```bash
cd apps/web
npm install
npm run dev
```

## Build replay

The human **Build replay** control and `window.ashfox.capture({kind:"build"})`
use one source-derived replay. It starts from an empty scene, places every
visible element in deterministic canonical element order, applies each
element's complete owning texture set atomically, activates canonical authored
idle motion when available, and holds on the complete model. The resulting GIF
is the sole capture artifact for the active source revision; it is
non-persistent, transient evidence, not an authoring authority or a decision
log.

## Architecture

- Keep the viewport dominant and the human surface observation-only except for
  project, view, playback, capture, and delivery controls.
- The canonical `.ashfoxworkspace` container is durable authority;
  `ProjectDocument` is disposable compiled state rebuilt from its selected
  entry closure.
- Each `ashfox-model 1` file contains one nominal module or asset. Package
  manifests and the exact compiler lock close imports and dependencies.
- Design, rig, skeleton, surface, component, motion, and asset declarations own their
  explicit decisions; compiled geometry and textures are never a second source.
- IndexedDB uses revision compare-and-write and cannot roll back newer state.
- Three.js objects are ephemeral view state rebuilt from the selected entry.
- The Agent Command Port atomically applies one complete workspace change set.
  Human UI actions
  do not decide or mutate asset semantics, and no generated model becomes a
  second authority.
- `/workbench/agent-manifest.json` is the machine authority for agent
  operation and host-side artifact delivery.
- Blockbench and MCP are an optional compatibility route outside Web Studio;
  this browser bundle does not import that runtime or its contracts. Node
  persistence, SQLite, and worker packages are not Web Studio dependencies.

## Agent manifest consumers

`/workbench/agent-manifest.json` is generated from
`src/features/agent/agentManifest.ts`; do not hand-edit built output or treat a
README, prompt example, or cached command schema as an equivalent contract.
Its `authoring.language` describes current declarations and exact design
values; `pageApi` describes operations and observation guards; `workflow`
orders authoring and independent review. It is generated for both development
and production builds from the same source.

An integrating host should:

1. connect to `https://ashfox.io/workbench/` and fetch its current manifest;
   use a development URL only when explicitly selected, with its own manifest;
2. inspect current state and relevant read-only evidence; fetch the current
   command schema before constructing a write, using `nextActions` for guidance;
3. preview and atomically submit one complete workspace change through
   `workspace.apply`;
4. use inspect, present, and capture responses as revision-bound observations;
5. refetch after a product update instead of assuming a cached grammar applies.

This runtime asset-creation contract is distinct from the repository root
[`development-manifest.json`](../../development-manifest.json), which governs
product experience, engineering, contribution workflow, versioning, quality,
and architecture for code changes.

Repository contributors must update the manifest source, contract tests, and
affected human guide together when that workflow changes. See the root
[contribution guide](../../CONTRIBUTING.md).
