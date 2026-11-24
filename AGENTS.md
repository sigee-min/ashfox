# Repository agent bootstrap

Before changing this repository:

1. Read [config/development-manifest.json](config/development-manifest.json), the versioned
   authority for product experience, engineering, workflow, commit,
   versioning, quality, and architecture rules. Its closed schema is
   [config/development-manifest.schema.json](config/development-manifest.schema.json).
2. Use [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md) for the human onboarding map and
   verification commands, not as a second rule source.
3. Read [docs/architecture/codebase.md](docs/architecture/codebase.md) for
   ownership and dependency boundaries relevant to the change.

The repository manifest governs changes to Ashfox itself. Asset authors use the
native `.ashfox` sources, CLI and public user guides; these are separate audiences.
Repository PR workflows (`open-pr`, `review-pr`) live in `.agents/skills/`;
do not confuse them with the published asset-authoring skill in `skills/ashfox/`.
Do not copy the manifest's rules into this bootstrap file.
