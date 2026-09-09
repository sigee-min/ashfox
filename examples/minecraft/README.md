# Minecraft Java block example

```sh
npm run build:cli
node apps/cli/dist/ashfox.cjs build examples/minecraft/.ashfoxworkspace --json
node apps/cli/dist/ashfox.cjs verify examples/minecraft/dist/build --json
```

`marker.ashfox` is a static textured model. The workspace selects `java_block`,
namespace `demo`, and model path `props/marker`. The returned export directory
contains `pack.mcmeta`, a block model, a blockstate and canonical PNG textures.
The game must already provide the block ID `demo:props/marker`, for example through
a mod; a resource pack does not register a new block.

For an existing-block replacement, choose that block's namespace and path, and
ensure its blockstate variants match the generated definition. No installation
into a Minecraft directory is performed. Output has been checked by CLI tests;
in-game appearance has not been validated.

See the [CLI documentation](../../apps/cli/README.md#minecraft-targets) for
GeckoLib 5 and Bedrock output and the remaining pack/registration work.
