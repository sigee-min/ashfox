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
npm run test:blockbench
npm run build:public
npm run build:blockbench
```

## Showcase media

The homepage and README replays are reconstructed from the final validated
entries in `examples/shared-creatures.ashfoxworkspace`; they are not an
authoring history or a decision log. Regenerate all checked-in replay and
poster media through the real Web renderer with:

```bash
npm run showcase:capture
npm run showcase:check
```

The capture command starts an isolated local Workbench, renders both entries,
and seals `assets/showcase/shared-creatures/showcase.json`. It requires Chrome
or Chromium; set `ASHFOX_CHROME_PATH` when the executable is outside a standard
location. Do not hand-edit the generated media or descriptor. Event ordering,
source/build provenance, dimensions, frame counts, and artifact hashes are
checked; exact GIF bytes are not claimed to be stable across browser, GPU, and
operating-system implementations.

Run the complete quality gate before a substantial pull request:

```bash
npm run quality
```

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
