# Contributing

Thanks for contributing to ashfox.

The versioned [development manifest](development-manifest.json) is the
repository development authority. Its
[closed schema](development-manifest.schema.json) and validator prevent this
guide from becoming a second, drifting rule source. This file only explains
how to find and apply that contract.

## Start with the manifests

- Repository contributors and coding agents read
  [`development-manifest.json`](development-manifest.json). Its
  `productExperience`, `engineering`, `workflow`, `versioning`, `quality`, and
  `architecture` sections declare the applicable rules.
- Agents operating the Web Studio fetch the generated
  `/workbench/agent-manifest.json`, whose source is
  [`apps/web/src/features/agent/agentManifest.ts`](apps/web/src/features/agent/agentManifest.ts).
  That runtime manifest declares asset-creation commands and workflow; it does
  not govern repository development.
- Human guides explain both workflows but do not replace either manifest.
  Integrators fetch the current runtime manifest rather than embedding a copy.
- The installable [ashfox skill](skills/ashfox/SKILL.md) and its
  [default prompt](skills/ashfox/agents/openai.yaml) connect asset agents to
  ashfox.io and preserve user intent. They route to the live runtime contract;
  they are not a repository bootstrap or a copied language manual.

Read [the codebase map](docs/architecture/codebase.md) for rationale and an
ownership map after reading the development manifest.

## Project areas

- `apps/web` — the browser-local ashfox studio.
- `apps/site` — the landing page and published user guides.
- `packages/engine-core` — host-independent project types, commands,
  validation, and exporters.
- `packages/blockbench-*` and `apps/blockbench-*` — the optional Blockbench MCP
  compatibility track.
- `docs` — task-oriented user documentation published at
  [ashfox.io/docs](https://ashfox.io/docs/).

Use `architecture` for package dependency boundaries and `quality.ownerLayout`
for filenames, test owners, and limits. The codebase map explains these rules
without creating a second copy of the policy.

## Maintain docs, manifests, and prompts

| Change | Maintained source | Verification |
| --- | --- | --- |
| Repository policy | Development manifest, schema, and consuming gates | `npm run quality:manifest` and `npm run quality:check` |
| Asset API or authoring workflow | Runtime manifest source, API readers, and agent tests | `npm run test:web` |
| Browser agent execution | Public API, React presentation, review, and capture | `npm run test:web:browser` |
| Language concepts or examples | Relevant architecture/guide page and compiler regression | `npm run test:engine-core` and `npm run test:site` |
| Connection instructions or default prompt | Skill entrypoint and `agents/openai.yaml` | `npm run test:skill` and a scoped instruction review |

Keep the task-oriented copy prompt in
[Get started](docs/guides/ai-agent-quick-start.md). The runtime manifest owns
request details; the [precision guide](docs/guides/precision-modeling.md)
owns the complete tested resize example. Inspect actual readers and compiler
behavior before changing claims. A feature addition does not itself require
changing development policy, source grammar version, or release version.

Generated site pages, manifests, and skill packages come from these sources.
Use the existing build commands instead of editing generated copies.

`docs/public.json` selects public documentation and its reading order. It also
controls the Workbench's downloadable references. Keep repository ownership
and implementation notes outside this catalog; adding a Markdown file does
not publish it automatically.

## Development setup

```bash
npm install
npm test
npm run build
```

Useful focused commands:

```bash
npm run dev:web
npm run test:site
npm run test:web
npm run test:web:browser
npm --workspace @ashfox/site run test:browser
npm run test:blockbench
npm run build:public
npm run build:blockbench
```

## Browser workflow verification

The browser agent regression starts an isolated Workbench and drives its public
API through source discovery, candidate validation, preview, atomic apply,
every rendered review, and Build capture. It requires Chrome or Chromium;
set `ASHFOX_CHROME_PATH` if needed. Its automatic review acknowledgements test
the protocol with a known fixture, not the artistic quality of arbitrary assets.
Use `--development` to repeat the regression with React's development effect
replay enabled; CI checks both development and production builds.
For an observed visual pass, run `npm run test:web:browser -- --manual` and
open the printed local URL. The harness pauses for candidate inspection and
each review decision. Test tooling is served separately and is not shipped in
the public Workbench bundle.

## Showcase media

The homepage and README replays are reconstructed from the final validated
entries in `examples/shared-creatures/`; they are not an
authoring history or a decision log. Regenerate all checked-in replay and
poster media through the real Web renderer with:

```bash
node scripts/export-examples.js
npm run showcase:capture
npm run showcase:check
```

The export command reads the native shared example and refreshes standalone `.ashfox` examples plus browser model snapshots under `assets/workspaces/` and GLB exports. These snapshots are generated outputs.
The capture command starts an isolated local Workbench, renders all three entries,
including every finished motion, and seals `assets/showcase/shared-creatures/showcase.json`.
Motion movies require FFmpeg (or `ASHFOX_FFMPEG_PATH`). It requires Chrome
or Chromium; set `ASHFOX_CHROME_PATH` when the executable is outside a standard
location. Do not hand-edit the generated media or descriptor. Event ordering,
source/build provenance, dimensions, frame counts, and artifact hashes are
checked; exact GIF bytes are not claimed to be stable across browser, GPU, and
operating-system implementations.

Run the complete quality gate before a substantial pull request:

```bash
npm run quality
```

## Code-authored audio harness

`npm run build:audio` initializes the local source store on first use and builds
an isolated candidate. `npm run audio:review` serves sound selection, baseline/candidate
comparison and downloads in a read-only local viewer. Agents use `npm run audio:agent` or the
local HTTP API to inspect, propose, build, present, apply and export.
FFmpeg is required for builds (`ASHFOX_FFMPEG_PATH` selects the executable).

`npm run test:audio` verifies DSP and state transitions;
`npm run test:audio:integration` runs the real encoder and HTTP lifecycle.
See [`scripts/audio/README.md`](scripts/audio/README.md) for setup and limits,
and [`docs/guides/sounds.md`](docs/guides/sounds.md) for the closed
native source contract. Examples in `examples/sounds/` use the same root
workspace configuration as other asset projects and the public audio core.
The local viewer remains separate from public Workbench and game runtime adapters.

## Apply the development manifest

The manifest's `workflow` section identifies the change lifecycle and the
verification profile. `engineering.testing` defines behavioral coverage, and
`architecture` and `quality` feed the automated gates. Validate the manifest
and its consumers with:

```bash
node scripts/quality/manifest/index.js
npm run quality:check
```

Edit the manifest only when intentionally changing repository policy. Change
its schema, validator fixtures, consuming gates, and this navigation text in
the same reviewable change.

## Code conventions

Use `engineering.style` and `engineering.principles` in the development
manifest as the rule source. The [codebase map](docs/architecture/codebase.md)
explains how those rules map to concrete package boundaries.

## Tests

The required behavioral and stateful paths are declared in
`engineering.testing`. Use focused workspace tests while iterating and the
verification commands declared by `workflow.verification` before handoff and
pull request.

## Pull requests

Use `workflow` for scope and generated-artifact policy. In the PR description,
explain the user-visible outcome, why it is needed, and which declared checks
you ran.

## Commit messages

`workflow.commits` is the authority for format, allowed types, subject style,
atomicity, and breaking-change review. release-please consumes that declared
commit format when preparing a release.

## Versioning

The manifest's `versioning.product`, `versioning.assetWorkspace`, and
`versioning.deliveryTargets` entries deliberately separate product releases,
the exact-current portable workspace and source grammar, and transient delivery
inputs. Follow their named authorities, ownership, and verification fields; do
not infer one contract from another.

## Reporting bugs

Open an issue with:

- expected behavior
- actual behavior
- reproduction steps
- ashfox version or commit
- affected surface: web studio or Blockbench MCP
- browser and export target, or Blockbench version and model format

For security issues, follow [SECURITY.md](SECURITY.md).

## Item sprite study

`npm run build:items` compiles the native `.ashfox` item examples into native PNGs, stage
previews and hash receipts. `npm run items:studio` opens a local source/result
studio; `npm run items:agent -- capabilities` describes the candidate workflow.
`npm run test:items` verifies the compiler and harness. See
[`scripts/items/README.md`](scripts/items/README.md) for the implemented contract
and [`item sprite design`](docs/architecture/item-sprites.md) for integration plans.
Models, sprites and sounds share the native CLI; the local viewer remains separate from the public Workbench.

## Directory projects

Native `.ashfox` source files compile without a workspace. The optional root
`.ashfoxworkspace` v2 file supplies shared repository configuration when needed. See [directory workspace](docs/guides/workspace.md)
for include/ignore/output semantics and native sprite syntax. The working folder
example is `examples/items/`. `npm run test:engine-core` includes native sprite
parity and mixed model/sprite project regression tests. Browser model snapshot fixtures exercise the separate Workbench API. They are
not native CLI project configurations.

## Native asset CLI

`npm run build:cli` bundles the standalone CLI. Run
`node apps/cli/dist/ashfox.cjs build examples/pipeline/.ashfoxworkspace --json`
for model, item and sound output, or pass a single `.ashfox` file without a
workspace. `npm run test:cli` verifies cold builds, interruption, integrity and
isolated npm installation. `npm run test:audio-core` checks the shared DSP.
See [CLI usage](apps/cli/README.md) for the output and game-build contract.

`npm run test:packs` verifies configurable Java pack delivery with real FFmpeg
Vorbis encoding. Use FFmpeg on PATH or `ASHFOX_FFMPEG_PATH`. See the
[pack contract](docs/guides/minecraft-packs.md) and the native example in
`examples/resource-pack/`. The regular CLI suite also checks PNG/model packs
without requiring an external encoder.

`examples/game-assets/` exercises engine-neutral model, sprite and sound bundles.
Static-prop coverage is added only within the CLI test fixture.
The regular CLI suite validates portable GLBs, runtime manifest linkage, and
shared Minecraft/general-engine delivery. See [game assets](docs/guides/game-assets.md).

`npm run test:cli` covers memory observation and stdio state. Run
`npm run test:cli:capture` with Chrome/Chromium (or `ASHFOX_CHROME_PATH`) for real
PNG/GIF/waveform, camera, cancellation and renderer recovery tests. Rendering
code lives in `packages/render-core` and is shared with the browser Workbench.

User documentation publishing and example verification: [docs maintainer guide](docs/development/docs.md).
