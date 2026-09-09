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
[local sound viewer](../../scripts/audio/README.md). Its initial source set
comes from this directory. See the [sound syntax guide](../../docs/guides/sounds.md).

Seed variations affect noise and vocal irregularities. The pure FM bird call
has identical seed-only variants. Names describe intended character; these
examples do not claim verified animal realism.
