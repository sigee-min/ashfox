# Contributing to Ashfox

This guide is for people changing Ashfox itself: its implementation, documentation,
translations and releases. To create assets or integrate Ashfox into a game, use
[the user documentation](../docs/README.md).

The [development manifest](../config/development-manifest.json) and its
[closed schema](../config/development-manifest.schema.json) are the versioned repository
rule authority. Read them before changing code, then use the
[codebase map](../docs/architecture/codebase.md) for ownership and dependency boundaries.
This guide describes onboarding and commands rather than defining parallel rules.

## Product path

Ashfox assets are native `.ashfox` source files. The CLI checks, renders,
builds and exports them. Projects configure grouped inputs and deterministic
delivery through `.ashfoxworkspace` or `.ashfoxworkspace.mjs`.
The website publishes documentation, examples and read-only model previews.

Asset agents use the [Ashfox skill](../skills/ashfox/SKILL.md), public guides and the
installed CLI contract. Repository contributors use this guide, the development
manifest, and the repository PR skills in `.agents/skills/` (`open-pr`, `review-pr`).
The published `skills/ashfox/` skill is an asset workflow guide, not a repository bootstrap.

## Project areas

| Area | Responsibility |
| --- | --- |
| `apps/cli` | Native asset commands (`init`, `doctor`, `check`, `render`, `build`, `export`) and integration tests |
| `apps/site` | Landing, localized user guides and read-only example previews |
| `apps/audio-study`, `apps/item-study` | Local review applications |
| `packages/engine-core` | Host-independent source contracts, compiler and exports |
| `packages/asset-build` | Bundle assembly, delivery and Node I/O adapters |
| `packages/audio-core` | Deterministic audio synthesis |
| `packages/render-core` | Headless scene rendering, capture and build replay |
| `scripts/` | Build, release, media and quality automation |

## Setup

Use Node.js 24 or newer and install the repository dependencies:

```sh
npm ci
npm run build:cli
npm run build:public
npm run preview:public
```

Build the complete static deployment with `npm run build:public` before previewing
that bundle. Site output is generated in `apps/site/dist`; deployment output is
`dist/public`. Do not edit generated files. React and a browser authoring app are
not required for this product path.

## Verification

| Change | Relevant checks |
| --- | --- |
| Source contracts and compiler | `npm run test:engine-core` |
| CLI and asset delivery | `npm run test:cli` |
| Real PNG/GIF capture | `npm run test:cli:capture` |
| Site and localized documentation | `npm run test:site` |
| Landing interaction and responsive layout | `npm --workspace @ashfox/site run test:browser` |
| Downloadable documentation examples | `node scripts/docs/build.js && node scripts/docs/test.js` (add `--capture` for renders) |
| Skill packages and update verification | `npm run test:skill` |
| Audio synthesis and local review | `npm run test:audio-core` and `npm --workspace @ashfox/audio-study run test` |
| Audio encoding and HTTP lifecycle | `npm --workspace @ashfox/audio-study run test:integration` |
| Item snapshots and failed-build isolation | `npm --workspace @ashfox/item-study run test` |
| Java pack delivery with FFmpeg | `npm --workspace @ashfox/cli run test:packs` |
| Repository rules, types, complexity and architecture | `npm run quality:check` |
| PR metadata and template check | `npm run quality:pr -- ...` (`node scripts/quality/prCheck.test.js`) |
| Code formatting | `npm run format` |
| Example output bytes unchanged | `npm run quality:products` |
| Function size and complexity ratchet | `node scripts/quality/complexity.js` |
| Complete release gate | `npm run quality` |

`quality:products` compiles every example in memory and compares product and
artifact digests with `scripts/quality/products-baseline.json`. Refactors must
leave it unchanged; reseal with `npm run quality:products:seal` only in a change
that intends to alter compiled output, and explain the difference in review.

Complexity gates limit function lines, control nesting and cognitive
complexity in the scopes declared by `quality.complexity` in the development
manifest. Existing violations are listed in `scripts/quality/complexity-baseline.json`,
which may only shrink: after reducing a function, run
`node scripts/quality/complexity.js --write` and commit the smaller baseline.

Prettier formats TypeScript and JavaScript code. Its options derive from
`engineering.style` in the development manifest; change the manifest, not the
derived `config/prettier.config.js`. Run
`git config blame.ignoreRevsFile .git-blame-ignore-revs` to skip formatting
commits in `git blame`.

## Pull request workflow

Changes to `main` land through scoped pull requests rather than direct commits:

- **Branch naming**: `<type>/<short-slug>` using a type from `workflow.commits.types`
  in the development manifest (`feat`, `fix`, `refactor`, `test`, `docs`, `chore`)
  and a lowercase kebab-case slug.
- **PR title and merge strategy**: Use Conventional Commits matching the manifest
  commit policy (`!`, plus a `BREAKING CHANGE:` footer when breaking). Default to
  **Squash and merge** so the PR title becomes the commit on `main`.
- **Template and CI check**: Fill all sections in
  [PULL_REQUEST_TEMPLATE.md](PULL_REQUEST_TEMPLATE.md) (`Summary`,
  `Scope & Impact`, `Verification`, `Review Checklist`). Non-draft PRs require
  checked verification and review items. CI validates this via
  `.github/workflows/pr-check.yml`; dry-run locally with:
  `npm run quality:pr -- --branch "$(git branch --show-current)" --title "<title>" --body-file <file>`

Real rendering needs Chrome or Chromium; select it with `ASHFOX_CHROME_PATH`.
OGG audio encoding and showcase movies use built-in WebAssembly encoders and require no external FFmpeg.
Compilation and regular CLI checks do not require a browser UI session.

## Examples and media

`examples/` owns native sources. `assets/` contains published example media and
reproducibility receipts. Showcase generation calls the CLI directly:

```sh
npm run build:cli
node scripts/showcase/export.js
npm run showcase:capture
npm run showcase:check
```

The capture command renders all three creatures into staged PNG/GIF/MP4 files,
then publishes them and their descriptor. Build replay is reconstructed from the
finished model; it does not represent source editing history or agent reasoning.
Review regenerated media visually before committing it.

For local review application setup, see [audio study](../apps/audio-study/README.md)
and [item study](../apps/item-study/README.md). These tools inspect source results;
game delivery continues through the common CLI.

## Documentation and releases

The [contributor guides](../docs/contributing/README.md) cover documentation publishing,
translations, release maintenance and branding. `docs/public.json` selects public
user pages; implementation documentation stays outside that catalog.

Use conventional commits according to the development manifest. Release version
changes are owned by the release PR workflow. For security issues, see [SECURITY.md](SECURITY.md).
