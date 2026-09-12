# Asset pipeline implementation

Users start with the [first build](../guides/ai-agent-quick-start.md),
[workspace settings](../guides/workspace.md), and [CLI reference](../guides/cli.md).
These guides describe the implemented native input and delivery contract.

`engine-core/project/directory` owns closed workspace and pack configuration;
`compiler/directory` resolves and compiles declared source graphs. Model and
sprite compilation remain in engine-core; audio-core owns deterministic PCM
synthesis. Pure compilers receive source records without filesystem access.

`asset-build` composes named exports into Minecraft or general game bundles.
Its Node adapter owns source snapshots, bounded workers, FFmpeg processes,
writer locks, receipts, immutable destinations and atomic current publication.
`apps/cli` exposes capabilities, check, build and verify over that adapter.

The public website contains documentation and read-only examples. Asset editing
and compilation use native sources and the CLI. Runtime game importers consume generated files
and metadata; no engine-specific runtime loader, watch service, remote cache or
automatic game installation is implemented.

See [codebase ownership](codebase.md) for dependency boundaries. Configuration
readers and compiler tests define the executable contracts; this document does
not introduce another schema or future input language.
