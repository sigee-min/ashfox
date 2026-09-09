# Mixed native asset pipeline

`.ashfoxworkspace` applies shared rules to the model, item and sound sources in
this directory. Edit the `.ashfox` files and rebuild:

```sh
npm run build:cli
node apps/cli/dist/ashfox.cjs build examples/pipeline/.ashfoxworkspace --json
node apps/cli/dist/ashfox.cjs verify examples/pipeline/dist/build --json
```

`dist/build/current.json` identifies one complete bundle. Its `catalog.json`
provides the griffin model, iron sword icon and claw-hit audio variants. The
configured exports are under `dist/models`, `dist/items` and `dist/sounds`, each
in `bundles/<hash>`. Always use the hash from the build result or pointer.

All outputs are derived and ignored by Git. This is an engine-neutral build
example, not an installable game mod or resource pack.
