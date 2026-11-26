# Render and check one asset

Use the CLI as a unified asset compiler and renderer: load any `.ashfox` source (model, sprite, sound, or structure); run `check` to inspect identifiers, declared outputs/previews, and quality audit scores; render declared `preview [name]` blocks with `render [--view <name>]`; build declared targets with `build`.

## First render and check

After [installing the CLI](install.md), run these commands on a starter asset:

```sh
npx --no-install ashfox check fox.ashfox
npx --no-install ashfox render fox.ashfox --output fox.png
```

`render` writes PNG or animated GIF bytes to stdout (or `--output <file>`). `check` writes an `ashfox-cli-result` JSON envelope with source summary, declared `outputs` and `previews`, nodes/textures/animations (for models and structures), variants (for sounds), and quantitative quality `audit` metrics.
Rendering requires Chrome or Chromium; set `ASHFOX_CHROME_PATH` when it is not at a standard installation path. An explicit invalid path fails.
Compilation, checking, auditing, and `build` do not require Chrome.

The renderer applies the shared scene projection, camera presets, material rules,
and animation sampling from Ashfox’s rendering library. It starts a private headless process
with an ephemeral browser profile and removes that profile on normal cleanup.
No implicit workspace or asset folder is created by single-asset `check` or `render`.

## In-memory inputs (stdin and JSON)

`check` and `render` can read from memory without touching disk when using `--stdin` or `--input-json`:

```sh
# Pipe a standalone .ashfox source on stdin
cat marker.ashfox | npx --no-install ashfox render --stdin --name marker.ashfox > marker.png

# Pass a multi-file source graph as JSON on stdin
# {"name":"main.ashfox","source":"...","files":{"shared.ashfox":"..."}}
cat graph.json | npx --no-install ashfox check --input-json
```

When piping memory sources with relative imports, send `--input-json` with `{ "name": "main.ashfox", "source": "...", "files": { ... } }`. Existing `--output` paths are rejected (`wx`), never overwritten.

## Declare `preview` views in `.ashfox`

Instead of asset-specific CLI flags, declare one or more named `preview` blocks inside any `model`, `sprite`, `sound`, or `structure` entry and select one with `--view <name>` (defaulting to `default`):

```text
model fox {
  preview default { azimuth = 45; elevation = 20; width = 640; height = 360; }
  preview turnaround { sheet = turnaround; width = 1024; height = 1024; }
  preview wag { kind = gif; clip = "tail_wag"; duration = 1; fps = 8; }
  ...
}
```

```sh
npx --no-install ashfox render fox.ashfox --view default --output orbit.png
npx --no-install ashfox render fox.ashfox --view turnaround --output turnaround.png
npx --no-install ashfox render fox.ashfox --view wag --output wag.gif
```

Use new filenames when repeating these commands. Sound checking returns compiled variant metadata plus a quantitative `audit` report; declaring `preview inspect { sheet = inspect; }` renders a pure-CPU 800×520 4-panel sheet without Chrome, while single-variant `render` captures a peak-envelope waveform. Sprite checking returns the receipt, pixel ownership evidence, and a quantitative `audit` report; declaring `preview inspect { sheet = inspect; }` renders a pure-CPU 512×512 4-panel sheet without Chrome. Use `build` to produce playable WAV files and final PNG/GLB/NBT outputs.

| Preview field | Accepted values and asset compatibility |
| --- | --- |
| `kind` | `still` (default PNG) or `gif` (animated GIF) |
| `camera` | `perspective`, `native`, `front`, `back`, `left`, `right`, `top`, `bottom` (model/structure) |
| `sheet` | `turnaround` (`FRONT`, `3/4`, `SIDE`, `BACK` for model/structure) or `inspect` (pure-CPU `1x/zoom/silhouette/luma/palette` for sprites/tiles; pure-CPU `waveform/spectrogram/6-band/variants` for sounds) |
| `azimuth`, `elevation`, `zoom` | Orbit angles (`-360..360`, `-89..89`) and zoom (`0.1..10`) (model/structure) |
| `width`, `height` | Integer `16..2048` (defaults `640x360` for model/structure/waveform) |
| `environment`, `background` | `studio`/`day`/`evening`/`night`; `environment`/`transparent`/`checker`/`light`/`dark` |
| `clip`, `time` | Clip ID/name and seconds (model) |
| `mode`, `fps`, `duration` | GIF mode (`motion`, `turntable`, `build`), `fps` (`1..30`), `duration` (`0.01..30`) |
| `wireframe`, `skeleton`, `textures` | Booleans controlling model overlays |
| `texture` | Render one model texture atlas as PNG |
| `scale` | Integer `1..32` nearest-neighbor scaling (sprites and texture atlases) |
| `stage` | Sprite `final`, `silhouette`, `shade`, `grain` |
| `variant` | Sound variant ID (defaults to first compiled variant) |
| `cutaway` | Structure horizontal slice height Y (`1..64`) |

Limits are 300 frames and 100 million rendered pixels per GIF. Build replay uses fixed `640x360` at `10` fps.

## Declare `outputs` and run `build`

Declare build targets inside the entry's `outputs { ... }` clause (optional; defaults are portable GLB for models, PNG for sprites, WAV for sounds, and both `java_structure` `.nbt` and portable `.glb` for structures):

```text
model marker {
  outputs {
    glb;
    java_block namespace = "demo" path = "props/marker";
  }
  ...
}
```

```sh
npx --no-install ashfox build marker.ashfox --json
```

Valid output formats are `glb`, `gltf`, `java_block`, `geckolib5`, and `bedrock` for models; `png` for sprites; `wav` for sounds; and `java_structure` / `glb` for structures. Model and structure builds require a passing quality audit (`settings.profile` + `score >= 75` for models; `score >= 75` for structures). Configured multi-asset game bundles and sound resource packs use [the project build pipeline](workspace.md).

## Compare actual views

![Fox from the front](/media/guides/fox-front.png)
![Fox at an orbit angle](/media/guides/fox-angle.png)

These are renders of the same source. Preview settings change observation only,
never built geometry or outputs. [Review and refine](authoring-and-review.md) explains
how to inspect views and motion when iterating on an asset.
