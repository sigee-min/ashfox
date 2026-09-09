# Native item studio

Create items in `.ashfox` source files using the [sprite guide](../../docs/guides/sprites.md).
Build game outputs with the [CLI](../../docs/guides/cli.md).

```sh
npm run build:items
npm run items:studio
node scripts/items/serve.js examples/items/.ashfoxworkspace
```

The default project is `examples/items/.ashfoxworkspace`. Pass a standalone
`.ashfox` entry or configuration path to `build.js` or `serve.js` for another
project. The local studio binds to `127.0.0.1:4318`; `ASHFOX_ITEMS_PORT` changes
the port. Rebuild and restart after edits: the studio serves a fixed build.

Inspect compiled items, source modules, native PNGs, shading stages and pixel
provenance. Preview backgrounds and enlarged images are presentation only.
Author changes in source files, then compile again. Use the common CLI for
resource packs and engine-neutral bundles; the studio is an optional viewer.

`npm run items:agent -- capabilities` exposes the common native CLI commands.
Run `npm run test:items` to verify the local studio and compiler integration.
