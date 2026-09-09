# CLI distribution

Status: GitHub CLI distribution starts at `v1.0.0`. README and installation
instructions pin the released CLI and matching starter. Native executables and
npm registry publication remain future work. Keep this maintainer guide outside
`docs/public.json`.

## Operate the release

1. Merge the implementation into `main`. Run the existing **release** workflow
   in `prepare` mode, review and merge its release-please version PR.
2. Run **release** in `publish` mode on that exact `main` commit. It runs the
   complete quality gate, builds the release assets once, and tests those bytes
   on Linux, macOS and Windows with Node 20 and 24. All six jobs must pass.
3. The publisher creates a draft for the root product version, uploads and
   downloads every asset to verify SHA-256, then publishes. Its release notes
   include version-pinned installation, offline init, the first PNG export and
   the exact version’s CHANGELOG section, including breaking changes.
4. After publication, the workflow verifies public CLI, starter and checksum
   downloads, confirms the public release is immutable, and opens
   `release/stable-downloads`. Merge that documentation PR
   after CI passes. `scripts/release/stable.json` is the sole stable version
   authority; `stable.js` synchronizes Markdown links and the site reads it
   directly. New product versions do not advance stable downloads before release.

Retry the workflow on the same commit after a transient failure. Matching draft
assets are reused; differing bytes fail without replacement. A published release
is verified read-only. A version tag pointing at another commit fails; prepare
a new version instead. This deliberately replaces the former HEAD-parent bump
heuristic. API errors fail the run instead of being mistaken for missing releases.

`node scripts/release/artifacts.js` assembles `dist/release` after
`npm run build`. `node scripts/release/smoke.js` validates its URL/offline installs
and lockfile restoration. `npm run release:validate` includes publisher failure
and retry tests without contacting GitHub. The website and release use the same
packager, with the root version, license, bundled executable and no install hooks.

Repository-level immutable releases were enabled on 2026-09-09 for future
publications. Existing v1.0.0 was not republished. The publisher uploads and
verifies every asset while the release is a draft, refreshes draft notes on retry,
and checks the publication response for immutability. A mutable new release
fails the run and cannot advance stable documentation. No administrator token
is needed by the workflow: the repository setting is configured separately.

The package smoke test uses `npx --no-install --offline ashfox`, including Windows
command shims, help/version, doctor, offline init, GLB/PNG/WAV and a stdio
load/inspect/close session. Optional browser rendering still has its separate CLI
capture suite. The release notes include the exact version's CHANGELOG entry.

## User experience

The first visit should lead to one install command and one successful export.
Avoid requiring a repository clone, a build, a GitHub account, a global install,
or moving a downloaded package into the right folder. Keep Chrome and FFmpeg
optional and explain them only for capture and OGG tasks.

The [installation guide](../guides/install.md) carries the generated stable
commands. `scripts/release/instructions.js` owns the install check, first export,
offline check and availability text used by `stable.js` and release notes.
The 1.0.0 guide retains its supported ZIP workflow; subsequent stable releases
switch all first-run blocks to version, init and export together. Missing or
duplicate blocks fail validation before documentation is written.

The website also builds preview downloads; those mutable URLs are not used as
stable project dependencies. The versioned package and lockfile make installs
reproducible through `npm ci`.

## First release: versioned GitHub assets

Use public GitHub Releases as the distribution archive, not GitHub Packages.
The release workflow uploads the bundled CLI, starter and checksums alongside
the existing Blockbench/plugin-sidecar files.
Do not introduce an independent CLI release workflow or version counter.

| Release asset | Purpose |
| --- | --- |
| `ashfox-cli.tgz` | Complete npm-installable CLI, no runtime npm dependencies |
| `starter.zip` | Model, item and sound sources matching that compiler |
| `SHA256SUMS` | Hashes of every downloadable release artifact |

Each release URL must include the product tag. For example, after a release
containing the CLI exists, the install command has this form (the tag is a
placeholder, not an existing download):

```sh
npm install --save-dev https://github.com/sigee-min/ashfox/releases/download/vX.Y.Z/ashfox-cli.tgz
```

Publish the exact released tag in the installation page and README. Keep
`latest/download` for discovery only, not project dependencies. Users commit the
lockfile and run `npm ci`; upgrades explicitly select a new tag. Keep the local
tarball option for offline use.

### Ownership and guarantees

`scripts/release/package.js` generates distribution metadata from the root
product version without changing the internal workspace package version.
`scripts/release/starter.js` owns the sources shared by the offline init bundle
and the ZIP generated by `scripts/docs/build.js`.
`scripts/release/artifacts.js` collects CLI, starter, compatibility artifacts
and checksums. `smoke.js` tests the downloaded package; `publish.js` owns the
remote draft and publication lifecycle.

The workflow is intentionally manual: normal pushes do not publish versions.
Published files cannot be replaced through this pipeline. Signing/attestations
are not added here; SHA-256 verifies byte consistency, not independent identity.

## Next: remove Node from the installation path

GitHub hosting alone does not remove the Node/npm prerequisite. Add standalone
executables only after a packaging spike proves the complete CLI works with an
embedded runtime. Evaluate Node single-executable packaging against the actual
worker/child-process paths, embedded browser renderer and stdio behavior; do not
assume that bundling one JavaScript entry point makes the CLI self-contained.

Target macOS arm64/x64, Linux x64/arm64 and Windows x64 first. Each target needs
fresh-machine tests covering exports, persistent stdio, cancellation, Chrome
capture and external FFmpeg discovery. Establish signing/notarization and Linux
runtime compatibility before presenting this as the default path. Chrome and
FFmpeg remain optional external tools.

Then offer platform-specific archives with a single `ashfox` executable and
checksums. A small shell/PowerShell installer can detect the platform, download
a pinned release, verify its checksum, and install in a user-writable location.
It must report PATH changes, support an explicit version, avoid privilege
escalation, and leave the previous executable intact on failure.

## Registry and package managers

An npm registry package would shorten the command to
`npm install --save-dev @ashfox/cli`. Treat that as an optional second channel:
verify scope ownership, publish the same tested package through trusted
publishing, and keep GitHub as the versioned artifact archive. Do not document
this command as available before the package is actually published.

Homebrew and WinGet can follow stable native artifacts. Adding several package
managers before the release contract is reliable multiplies maintenance without
fixing the initial compiler/version mismatch.

## Completion criteria

A new user can copy one command from the README, check the installed version and export the
bundled starter sword without cloning Ashfox or manually moving packages. A clean CI
runner can restore an older version using only its committed dependency and
lockfile. A release cannot become latest until all documented downloads exist.
The standalone phase additionally requires installation without Node/npm on
each advertised platform.

References: [npm tarball installation](https://docs.npmjs.com/cli/install/),
[GitHub immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases),
[GitHub release creation](https://cli.github.com/manual/gh_release_create).
