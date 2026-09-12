# Contributing to Ashfox

This guide is for people changing Ashfox itself: its implementation, documentation,
translations and releases. To create assets or integrate Ashfox into a game, use
[the user documentation](docs/README.md).

The [development manifest](development-manifest.json) and its
[closed schema](development-manifest.schema.json) are the versioned repository
rule authority. Read them before changing code, then use the
[codebase map](docs/architecture/codebase.md) for ownership and dependency boundaries.
This guide describes onboarding and commands rather than defining parallel rules.

## Product path

Ashfox assets are native `.ashfox` source files. The CLI inspects, captures,
replays, builds and exports them. Projects configure grouped inputs and deterministic
delivery through `.ashfoxworkspace` or `.ashfoxworkspace.mjs`.
The website publishes documentation, examples and read-only model previews.

Asset agents use the [Ashfox skill](skills/ashfox/SKILL.md), public guides and the
installed CLI contract. Repository contributors use this guide and the development
manifest. The skill is an asset workflow guide, not a repository bootstrap.

## Project areas

| Area | Responsibility |
| --- | --- |
| `apps/cli` | Native asset commands, stdio sessions and integration tests |
| `apps/site` | Landing, localized user guides and read-only example previews |
| `apps/audio-study`, `apps/item-study` | Local review applications |
| `packages/engine-core` | Host-independent source contracts, compiler and exports |
| `packages/asset-build` | Bundle assembly, delivery and Node I/O adapters |
| `packages/audio-core` | Deterministic audio synthesis |
| `packages/render-core` | Headless scene rendering, capture and build replay |
| `packages/blockbench-*`, `apps/blockbench-*` | Optional Blockbench compatibility |
| `scripts/` | Build, release, media and quality automation |

## Setup

Use Node.js 24 or newer and install the repository dependencies:

```sh
npm ci
npm run build:cli
npm run build:site
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
| Downloadable documentation examples | `npm run test:docs` and `npm run test:docs:capture` |
| Skill packages and update verification | `npm run test:skill` |
| Audio synthesis and local review | `npm run test:audio-core` and `npm run test:audio` |
| Audio encoding and HTTP lifecycle | `npm run test:audio:integration` |
| Item snapshots and failed-build isolation | `npm run test:items` |
| Java pack delivery with FFmpeg | `npm run test:packs` |
| Blockbench compatibility | `npm run test:blockbench` |
| Repository rules and types | `npm run quality:check` |
| Complete release gate | `npm run quality` |

Real rendering needs Chrome or Chromium; select it with `ASHFOX_CHROME_PATH`.
Audio encoding and showcase movies need FFmpeg; select it with `ASHFOX_FFMPEG_PATH`.
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

For local review application setup, see [audio study](apps/audio-study/README.md)
and [item study](apps/item-study/README.md). These tools inspect source results;
game delivery continues through the common CLI.

## Documentation and releases

The [contributor guides](docs/contributing/README.md) cover documentation publishing,
translations, release maintenance and branding. `docs/public.json` selects public
user pages; implementation documentation stays outside that catalog.

Use conventional commits according to the development manifest. Release version
changes are owned by the release PR workflow. For security issues, see [SECURITY.md](SECURITY.md).
