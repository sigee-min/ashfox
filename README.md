# Ashfox

<p align="center">
  <img
    src="assets/showcase/shared-creatures/fox-build-replay.gif"
    alt="Reconstructed Fox build replay from an empty scene through geometry, textures, motion, and the complete model"
    width="440"
  >
  <img
    src="assets/showcase/shared-creatures/goblin-build-replay.gif"
    alt="Reconstructed Goblin raider build replay from an empty scene through geometry, textures, motion, and the complete model"
    width="440"
  >
  <br>
  <sub>A reconstructed build replay from the final validated entry — deterministic event order, not AI history or a decision log.</sub>
</p>

<p align="center">
  <a href="https://ashfox.io/#examples"><strong>Watch Fox + Goblin replays →</strong></a>
  &nbsp;·&nbsp;
  <a href="examples/shared-creatures.ashfoxworkspace"><strong>Download workspace</strong></a>
  &nbsp;then&nbsp;
  <a href="https://ashfox.io/workbench/"><strong>Launch Workbench</strong></a>
</p>

Ashfox compiles a closed, reusable asset codebase into Minecraft-style entity,
prop, and block products. Its portable authority is one `.ashfoxworkspace`:
exact `ashfox-model 1` modules, package manifests, and a content-addressed lock.

Source modules define exact shared designs, nominal rig contracts, skeletons, surface contracts,
deterministic textures, reusable components, motions, and explicit asset
assemblies. A selected entry builds one immutable scene, texture set, and
animation set. Generated products, reviews, replays, exports, and caches are
never editable authority.

## Create an asset

Connect the agent to [ashfox.io Workbench](https://ashfox.io/workbench/) and
give it this connection instruction:

~~~text
Fetch and follow https://ashfox.io/workbench/agent-manifest.json using a direct HTTP request such as curl.
~~~

Append your task. See [Get started](docs/guides/ai-agent-quick-start.md) for
creation, refinement, and read-only guidance.

1. Open or create a Workbench workspace.
2. Describe gameplay scale, facing, major masses, rig, reusable parts,
   material groups, and motion.
3. The agent inspects the current workspace hash, prepares one complete change
   set, and submits `workspace.apply` with an explicit selected entry.
4. The engine validates every declared entry before atomically advancing the
   workspace.
5. Review native/gameplay and orthographic views plus motion cycles, then
   export only after mechanical and visual gates are current.

## Reuse model

- Designs share exact dimensions, construction datums, and named checks.
- Rig contracts own semantic joints, frames, channels, mirrors, and sockets.
- Skeletons provide complete concrete rest implementations.
- Surface contracts own exact chart/material ABIs; surfaces own deterministic
  pixels.
- Components own lexical geometry behind typed rig/surface/socket ports.
- Motions target one nominal rig and bake through signed frames.
- Asset entries choose and connect these declarations explicitly.

There are no classes, inheritance, mixins, structural matching, wildcard
imports, runtime packages, automatic retargeting, hidden UV generation, or
target-specific source branches.

See [the codebase map](docs/architecture/codebase.md),
[the asset language](docs/architecture/asset-language.md),
[precision modeling](docs/guides/precision-modeling.md), and the executable
[`shared-creatures.ashfoxworkspace`](examples/shared-creatures.ashfoxworkspace).

## Development

Read [development-manifest.json](development-manifest.json), then
[CONTRIBUTING.md](CONTRIBUTING.md) and
[codebase.md](docs/architecture/codebase.md).

~~~sh
npm run typecheck
npm run typecheck:tests
npm run quality:manifest
npm run quality:architecture
npm run test:engine-core
npm --workspace @ashfox/web run test
npm run verify:design-corpus
~~~
