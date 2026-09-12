# @ashfox/blockbench-runtime

Blockbench-only execution runtime for the optional compatibility route. It is
separate from the native source and CLI product path.

Owns the editor adapters, project session, MCP transport, plugin lifecycle, and
sidecar communication used by the optional compatibility product. It consumes
the canonical `@ashfox/engine-core` compiler for its transient adapter views;
it does not define a second asset-workspace authority.

Boundary:

- `packages/engine-core` does not import the Blockbench runtime or contracts
