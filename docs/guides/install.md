# Install Ashfox

You need Node.js 20 or newer and npm. You do not need an account or API key.
Download [the CLI package](/downloads/ashfox-cli.tgz) and
[the starter assets](/downloads/starter.zip) from this documentation build.

## Set up your asset folder

Extract the starter ZIP into a writable folder, then put `ashfox-cli.tgz` in that
folder. Open a terminal there and run:

```sh
npm install --save-dev ./ashfox-cli.tgz
npx --no-install ashfox capabilities
```

The second command prints `ok: true` and the supported commands. Keep the package
file, `package.json` and `package-lock.json` with your project so another machine
can reproduce the installation. The package is a complete executable bundle.
The guides use `npx --no-install ashfox`: it runs your installed version and does
not fetch a different package when the CLI is missing.

If you already have a game repository, put the package in that repository and run
the same install command there. Do not replace an existing `package.json` with
the starter's file. A registry installation is not assumed by this guide.

## Choose optional tools

| Task | Additional tool |
| --- | --- |
| Inspect source; export PNG, WAV or model files; build WAV game packs | None |
| Capture images, atlas details or waveforms; create GIF replays | Chrome or Chromium |
| Build OGG sounds or a Minecraft pack containing sounds | FFmpeg with `libvorbis` |

Install these tools with your usual operating-system installer or package manager.
Ashfox does not install them automatically. Chrome need not be open, and capture
does not require FFmpeg. Set executable paths if automatic discovery fails.

macOS/Linux:

```sh
export ASHFOX_CHROME_PATH="/path/to/chrome"
export ASHFOX_FFMPEG_PATH="/path/to/ffmpeg"
```

Windows PowerShell:

```powershell
$env:ASHFOX_CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$env:ASHFOX_FFMPEG_PATH = 'C:\tools\ffmpeg\bin\ffmpeg.exe'
```

Paths must identify executable files, not directories. Check `ffmpeg -encoders`
for `libvorbis` before requesting OGG output.

## Shells and binary output

Commands that return PNG, GIF, WAV, GLB or ZIP produce binary stdout. For a saved
file, use `--output preview.png`; this works without depending on shell binary
redirection behavior, including older Windows PowerShell versions. Existing
files are rejected; choose a new filename. For in-memory use, collect bytes in
Node or another process API as shown in [stdio and memory](stdio.md).

## Upgrade or reproduce an installation

Keep a copy of the package used by a project. To upgrade, download a new package
into a versioned local folder and install that exact path. Review the lockfile
change, rebuild your assets and compare their appearance before adopting it.
Restore the previous package and lockfile to return to an earlier toolchain.
Pin Chrome/FFmpeg too when image or OGG byte comparisons matter.

Continue with [your first asset](ai-agent-quick-start.md).
