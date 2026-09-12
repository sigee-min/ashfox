# Asset project

Edit grouped sources in `asset/`. Customize `.ashfoxworkspace.mjs` to declare
packages, stable export IDs, formats and output paths. Keep generated `build/`
out of Git. This executable configuration is trusted Node.js project code.

Install and lock the Ashfox CLI at this project root following
https://ashfox.io/docs/guides/install/ . Commit the package and lock files.

```sh
npx --no-install ashfox build .ashfoxworkspace.mjs --json
npx --no-install ashfox verify build/assets/compiler --json
node assets.mjs
```

Import `buildAssets` from `assets.mjs` in your game build. Call it once, then
resolve exact catalog filenames with `built.file(exportId, relativeFilename)`.
Do not edit generated files or silently reuse output after a failed build.

The complete convention is documented at
https://ashfox.io/docs/guides/repository-layout/ .
