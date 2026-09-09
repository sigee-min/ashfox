# Run the assets in a web game

This complete Three.js example displays an animated creature,
lets you select motions, shows an item PNG and plays sound variants on a button
press. It uses the same `assets.json` contract as your game. It is an asset-import
sample, not a terrain engine or a complete gameplay project.

## Download and run

Download [the web-game project](/downloads/web-game.zip) and extract it into its
own folder. Put [the CLI package](/downloads/ashfox-cli.tgz) in that folder. With
Node.js 20 or newer:

```sh
npm install
npm install --save-dev ./ashfox-cli.tgz
npm run assets
npm start
```

Open the local URL printed by the server.
Keep the terminal running. This example uses WAV and needs no FFmpeg. Chrome is
not required for the asset build; use a browser with WebGL to view the game.
Do not open `index.html` as a file URL: model and audio loading use HTTP paths.

## Check the result

- The Griffin appears without placeholder objects.
- Choose each motion from the selector; the model should animate.
- The iron sword image has crisp pixel edges.
- Press **Play claw hit** repeatedly to hear the generated variants. Browser
  audio starts after your click rather than being forced on page load.
- The status line reports the loaded assets or the actual load/playback error.

`main.js` resolves stable asset IDs, loads GLB with `GLTFLoader`, selects clips
through `AnimationMixer`, assigns the sprite URL and plays the selected WAV.
The source is included, so you can replace those operations with your engine's
resource APIs. Three.js is pinned in the sample's `package.json`.

## Change and rebuild

Edit the native sources under `assets/`; use `assets/.ashfoxworkspace` to change
export settings and runtime IDs. Run `npm run assets` again, then reload the page.
That script builds a complete bundle and copies only its selected runtime folder
to `public/game-assets`. Captures are useful for reviewing source changes before
checking the result under the game's camera and lighting.

The sample uses one engine unit per meter, portable GLB and nearest sprite
filtering. The loader handles glTF axes; do not also rotate the source to compensate.
Source models encode one `u` as 1/16 meter. `unitsPerMeter` is an import hint and is
applied once by the sample. The HTML item is a UI image, so its CSS size controls
screen size; `pixelsPerUnit` matters when placing sprites in world space.

## Use another engine

Consume the whole `game-assets` folder so relative texture/audio paths remain
valid. Map each runtime ID to the importer or resource handle used by your game.
Apply the manifest's scale, filtering and sound-variant metadata deliberately.
GLB importer and animation support vary by engine; verify them before selecting
optimized encoding. The sample does not claim Unity, Godot or Unreal certification.
See [game bundle metadata](game-assets.md) and [import troubleshooting](troubleshooting.md).
