# Install Ashfox

You need Node.js 24 or newer and npm. You do not need an account or API key.

## Install in your project

Open a terminal in your game or asset folder and run:

<!-- ashfox:install -->
```sh
npm install --save-dev https://github.com/sigee-min/ashfox/releases/download/v2.0.1/ashfox-cli.tgz
npx --no-install ashfox --version
```
<!-- ashfox:install-end -->

<!-- ashfox:check -->
The second command prints the installed product version. Run
`npx --no-install ashfox doctor` to check optional Chrome support.
<!-- ashfox:check-end -->

The package contains the complete CLI and works with Node.js 24+ on macOS,
Linux and Windows PowerShell. Install it in your existing project; keep your
`package.json` and commit the updated lockfile.

## Make your first asset

<!-- ashfox:start -->
Create the bundled starter offline and build your first item:

```sh
npx --no-install ashfox init assets
npx --no-install ashfox build assets/assets/sprites/sword.ashfox --json
```
<!-- ashfox:start-end -->

Find `sword.png` (`iron_sword.png`) in the built export directory printed by
`build`. Edit the `.ashfox` source with your coding agent, then rebuild.

Commit `package.json` and `package-lock.json` with your project. The guides use
`npx --no-install ashfox` to run the installed CLI without fetching another
package when it is missing. The URL pins the CLI and matching starter from one GitHub release.
On another machine, run `npm ci` to restore the locked version. Use the offline
option below when you also need a local copy of the package.

## Command availability

<!-- ashfox:availability -->
The stable CLI includes help, version, environment checks and offline starter creation.
<!-- ashfox:availability-end -->

## Install offline or keep an exact package

Download [the CLI package](https://github.com/sigee-min/ashfox/releases/download/v2.0.1/ashfox-cli.tgz), store it in your project
(for example under `tools/`), and install that file:

<!-- ashfox:offline -->
```sh
npm install --offline --save-dev ./tools/ashfox-cli.tgz
npx --no-install ashfox --version
```
<!-- ashfox:offline-end -->

Keep the tarball and lockfile together. On another machine with Node.js and npm,
`npm ci --offline` restores this installation from the local tarball; other
project dependencies may also require an npm cache. No npm registry publication
is assumed by either installation path.

## If installation fails

- **`npm` is not found:** install Node.js with npm, reopen your terminal, then check `node --version` and `npm --version`.
- **The URL is blocked:** download the tarball through your browser or transfer it from another machine and use the offline command.
- **`ashfox` is missing:** run the install command in the same project folder, then retry the installation check above.
- **Permission denied:** use a writable project folder. A global installation or administrator privileges are not needed.

## Choose optional tools

| Task | Additional tool |
| --- | --- |
| Inspect source; export PNG, WAV, OGG or model files; build WAV/OGG game or Minecraft sound packs | None |
| Capture images, atlas details or waveforms; create GIF replays | Chrome or Chromium |

Install Chrome or Chromium with your usual operating-system installer or package
manager if you need visual captures or GIF replays. Ashfox does not install it
automatically. Chrome need not be open, and OGG encoding works built in without
FFmpeg. Set `ASHFOX_CHROME_PATH` if automatic discovery fails.

macOS/Linux:

```sh
export ASHFOX_CHROME_PATH="/path/to/chrome"
```

Windows PowerShell:

```powershell
$env:ASHFOX_CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
```

The path must identify an executable file, not a directory.

## Shells and binary output

Commands that return PNG, GIF, WAV, GLB or ZIP produce binary stdout. For a saved
file, use `--output preview.png`; this works without depending on shell binary
redirection behavior, including older Windows PowerShell versions. Existing
files are rejected; choose a new filename. For in-memory use, collect bytes in
Node or another process API as shown in [render and check](observe.md#in-memory-inputs-stdin-and-json).

## Upgrade or reproduce an installation

Choose a newer version from [GitHub Releases](https://github.com/sigee-min/ashfox/releases)
and install its exact CLI asset URL in your project. Review the lockfile change,
rebuild your assets and compare their appearance before adopting it. Restore
the previous dependency and lockfile and run `npm ci` to return to that version.
For offline projects, retain each tarball in a versioned local folder.
Pin Chrome too when image byte comparisons matter.

Continue with [your first asset](ai-agent-quick-start.md).
