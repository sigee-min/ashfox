# Automate asset builds

Pin the compiler package and source files in the game repository. If using OGG,
also pin the FFmpeg build used by CI. Run the local installed executable so a
missing dependency cannot trigger an unrelated package download.

## Add a build step

After [installing the CLI tarball](install.md), add scripts to your game project's
`package.json`:

```json
{
  "scripts": {
    "assets:check": "ashfox check assets/.ashfoxworkspace --json",
    "assets:build": "ashfox build assets/.ashfoxworkspace --json",
    "assets:verify": "ashfox verify assets/dist/build --json"
  }
}
```

These are fields to merge into your package file, not a replacement for the whole
file. Set the input path and verification directory to your actual configuration.

Run `assets:build` and `assets:verify` before the consuming game build. Every
nonzero exit code must stop the pipeline. The commands write JSON to stdout;
store the build response as evidence if needed.

## Consume returned paths

A minimal Node build step for an installed CLI is:

```js
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const cli = path.resolve('node_modules/@ashfox/cli/dist/ashfox.cjs');
const run = (...args) => JSON.parse(execFileSync(process.execPath, [cli, ...args, '--json'], { encoding: 'utf8' }));
const built = run('build', 'assets/.ashfoxworkspace');
if (!built.ok) throw new Error(JSON.stringify(built.diagnostics));
const pack = built.result.exports.find(entry => entry.id === 'voxel_game');
if (!pack) throw new Error('Missing configured pack');
console.log(pack.directory); // Pass this exact immutable directory to your copy/import step.
```

This uses Node directly and also works where shell executable shims differ.
`execFileSync` throws on a failed command. Do not continue using yesterday's pack
as if the failed build succeeded. A separate `verify` call checks the selected
canonical bundle; retain the build hash throughout your consumer run.

## Reproducibility and concurrency

The source/configuration, bundled compiler and execution profile contribute to
build identity. OGG adds the encoder fingerprint. Rebuilding in a clean output
folder with the same profile should reproduce the bundle hash. Equality across
different Node/V8/OS/architecture/encoder profiles is not promised.

There is no computation cache or watch mode. An existing immutable result is
verified after recomputation. Use a filesystem watcher or your build system to
invoke the CLI, without overlapping writers to the same output directories.
Concurrent builds targeting one destination fail with exit code 4.

## Deployment boundary

Upload or copy a verified immutable pack as a separate game-build step. The CLI
does not deploy servers, modify a user's installed game, or publish packages.
Choose `archive: true` when that step wants a ZIP; otherwise consume the emitted
folder. Version-control source, not runtime receipts or generated output.
