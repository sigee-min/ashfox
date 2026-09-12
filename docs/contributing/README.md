# Ashfox contributor guides

These guides are for people changing and maintaining Ashfox itself. To create
assets, configure an asset workspace or integrate build outputs into a game,
start with the [Ashfox user documentation](../README.md).

Read [CONTRIBUTING.md](../../CONTRIBUTING.md) for repository setup and verification.
The [development manifest](../../development-manifest.json) remains the repository
rule authority; these guides explain workflows without defining parallel policy.

| Contributor task | Guide |
| --- | --- |
| Publish documentation and regenerate example media | [Documentation publishing](docs.md) |
| Add a language or update translations | [Documentation translation](localization.md) |
| Build and publish CLI releases | [CLI release maintenance](cli-distribution.md) |
| Maintain product messaging and presentation | [Brand and positioning](branding.md) |
| Understand implementation ownership and dependencies | [Codebase architecture](../architecture/codebase.md) |

## Documentation audiences

- `docs/README.md`, `docs/guides/` and `docs/language/` serve developers using Ashfox
  to make assets and integrate them into games. `docs/public.json` selects the pages
  published on the product documentation site.
- `docs/translations/<locale>/` provides translations of those public user pages.
- `docs/contributing/` serves Ashfox contributors and release maintainers.
- `docs/architecture/` explains Ashfox internals for implementation contributors.

Contributor guides remain in the repository and are not included in the public
user documentation catalog or its language navigation. Name new guides by their
specific task and state their audience up front; avoid “development” as an audience
label because both asset authors and Ashfox contributors are developers.
