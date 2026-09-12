# Procedural sounds

Six code-authored sounds: griffin call, wolf howl, bird call, frog croak,
wing whoosh and claw impact. Edit the native `.ashfox` files in `src/`.
The root `.ashfoxworkspace` declares entries and WAV export destinations.
No recordings or external audio files are used.

From the repository root:

```sh
npm run build --workspace @ashfox/cli
node apps/cli/dist/ashfox.cjs build examples/sounds/.ashfoxworkspace --json
node apps/cli/dist/ashfox.cjs verify examples/sounds/build --json
```

The common CLI produces 48 kHz mono WAV files without FFmpeg or a browser.
Outputs under `build/` and `exports/` are generated and ignored by Git.

For playback, comparison and OGG downloads, use the
[local sound viewer](../../apps/audio-study/README.md). Its initial source set
comes from this directory. See the [sound syntax guide](../../docs/guides/sounds.md).

The four-second bird call uses eight articulated chirp layers across two phrases:
curved pitch contours, short answering whistles and fading trills. Each variant
changes the whistle detuning, smooth pitch jitter and breath reproducibly. It is
the landing page's playable sound example, with a -6 dBFS peak ceiling.
Seed variations also affect noise and vocal irregularities; pure FM remains
unchanged by seed alone. Names describe intended character; these examples do
not claim verified animal realism.
