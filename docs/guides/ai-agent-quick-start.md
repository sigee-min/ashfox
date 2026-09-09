# Your first asset

Start with one item, inspect a model, then make a small change. No workspace
configuration is required. [Install Ashfox and extract the starter](install.md)
before running these commands from your asset folder.

## 1. Produce an item PNG

```sh
npx --no-install ashfox inspect sword.ashfox
npx --no-install ashfox export sword.ashfox --output sword.png
```

Open `sword.png` with an image viewer. It is a transparent 16×16 item, ready to
use as an image asset. This step needs no browser or audio encoder.

![Iron sword enlarged against a checker background](/media/guides/sword.png)

The illustration above is an enlarged preview. The native export remains 16×16.
`sword.ashfox` imports `shared.ashfox`; keep both source files together.

## 2. Look from the angle you want

With Chrome/Chromium installed:

```sh
npx --no-install ashfox capture fox.ashfox --azimuth 45 --elevation 20 --output fox-angle.png
npx --no-install ashfox replay fox.ashfox --clip tail_wag --output tail-wag.gif
```

![Fox captured at 45 degrees azimuth and 20 degrees elevation](/media/guides/fox-angle.png)

You have a PNG of the chosen view and an animated GIF. These commands do not
create build directories or read a parent workspace. Omit `--output` to receive
bytes through a pipe or process API. See [observe an asset](observe.md).

## 3. Make one change

Ask an agent with file and command access:

```text
Make the sword blade lighter while keeping its silhouette and dimensions.
Read sword.ashfox and its imported shared.ashfox. Edit source only.
Inspect and capture the result at native size and enlarged scale.
Export a new sword-light.png and tell me what changed.
```

You can also edit the source in a text editor. Export/capture again with a new
filename; existing files are never overwritten by `--output`. Compare the
results and keep the source version you prefer. Passing compilation does not
replace looking at the image or listening to a sound.

## 4. Choose your next task

- [Create a model](models.md), [draw an item](sprites.md), or [make a sound](sounds.md).
- [Pass source and media in memory](stdio.md), including persistent agent sessions.
- [Run the assets in a web game](web-game.md).
- [Build a Minecraft resource pack](minecraft-packs.md).
- [Manage several assets](workspace.md) when shared output rules become useful.
