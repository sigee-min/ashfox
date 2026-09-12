# Create sound effects

Sound sources synthesize noise, FM tones and vocal-like layers into WAV variants.
Use them for impacts, movement, calls and other short effects. WAV compilation
needs no samples, browser or external encoder; OGG delivery uses FFmpeg.

## Build a complete sound

Save this complete source as `wind.ashfox`:

```ashfox
ashfox-model 1
sound wind {
  duration = 0.5;
  sampleRate = 48000;
  seed = 42;
  layers = [{
    id = "air";
    source = { kind = "noise"; };
    start = 0;
    duration = 0.5;
    gain = 0.8;
    attack = 0.05;
    release = 0.2;
    highpass = 100;
    lowpass = 6000;
  }];
  variants = [{ id = "base"; seed = 42; }];
  output = { rmsDb = -22; peakDb = -3; };
}
```

```sh
npx --no-install ashfox build wind.ashfox --json
```

In a standalone folder, find the export directory in the response, then
`wind/base.wav` inside it. An ancestor workspace changes source selection and
output paths; see [CLI reference](cli.md).

## Shape the sound

All record fields in the example are required. Sound numbers use the units in
the table; unlike model syntax, sound fields do not use unit suffixes.

| Field | Allowed value / effect |
| --- | --- |
| `duration` | 0.05–5 seconds |
| `sampleRate` | 48000; output is mono PCM16 WAV |
| `seed` | Integer 1–4294967295; reproducible variation |
| `layers` | 1–8 named layers |
| `variants` | 1–8 records with unique `id` and integer `seed` |
| `output.rmsDb` | -48 to -6 dBFS target loudness |
| `output.peakDb` | -12 to -1 dBFS peak ceiling; gain is reduced if necessary |
| Layer `start`, `duration` | Start >=0, duration >=0.02 seconds; must fit the sound |
| Layer `gain` | Linear 0–2 |
| Layer `attack`, `release` | Each >=0.002 seconds; their sum must fit the layer |
| Layer `highpass`, `lowpass` | 10–10000 Hz and 20–16000 Hz; highpass must be lower |

Sound IDs match `[a-z][a-z0-9_-]{0,63}`. Layer and variant IDs match
`[a-z][a-z0-9_]{0,31}`. Names used as workspace export IDs follow that workspace's
shorter naming rule. Each source has one `sound` declaration.

## Choose a source kind

| Kind | Required source fields |
| --- | --- |
| `noise` | `kind` only |
| `fm` | `kind`, `pitch` (two 40–3000 Hz endpoints), `sweepSeconds` (0.02–5), `ratio` (0.25–4), `index` (0–4), `vibratoHz` (0–25), `vibratoCents` (0–100) |
| `vocal` | `kind`, `pitch` (two 50–1200 Hz endpoints), `sweepSeconds` (0.02–5), three `formants` (150–7000 Hz), three `bandwidths` (40–1500 Hz), `breath`, `jitter`, `roughness` (each 0–1) |
| `chirp` | `kind`, `contour` (2–12 increasing `{ at, hz }` points spanning 0–1 of layer duration; 500–8000 Hz), `trillHz` (0–100), `trillCents` (0–300), `trillDepth` (0–1), `breath` (0–0.2), `jitterCents` (0–80), `brightness` (0–1) |

Use short noise with fast fades for impacts, shaped longer noise for movement,
and pitched layers for tonal details. Place syllables in separate layers.
Changing only a seed can leave a pure FM sound identical because it has no noise.
Named animal examples express design intent, not verified biological realism.

The [claw-hit source](../../examples/sounds/src/claw_hit.ashfox) is a complete
layered example. All sources in `examples/sounds/src` use the same native language.

The [bird-call source](../../examples/sounds/src/bird_call.ashfox) uses
`chirp` sources for continuous curved whistles, coupled pitch/amplitude trills,
and quiet breath. Contour `at` values are fractions of the containing layer's
duration. Pitch interpolates smoothly in log frequency. Seeds vary detuning and
smooth jitter as well as air noise; harmonics fade before Nyquist. The sound root and native header are unchanged.

## Deliver and listen

Use a WAV export for originals. Choose `audio: ogg` in a general game pack, or add
a Minecraft sound binding, to produce OGG. Install [FFmpeg](install.md#choose-optional-tools)
first. Minecraft bindings also configure variants/weights, volume, pitch, streaming
and an optional subtitle key. General game bundles list variants for your game to
select. Neither binds the sound automatically to combat or an animation.

Listen to every variant at intended gameplay volume and alongside other effects.
A successful encode checks duration and clipping, not whether an effect sounds
convincing. Lower source `peakDb` when lossy encoding overshoots its ceiling.

```sh
npx --no-install ashfox export wind.ashfox --variant base --output wind.wav
npx --no-install ashfox capture wind.ashfox --output wind-wave.png
```

Open the WAV in an audio player. The PNG is a waveform observation, not playable
audio. This is the claw-hit example; listen and compare its waveform:

<audio controls preload="none" src="/media/guides/claw.wav">Claw hit: <a href="/media/guides/claw.wav">download WAV</a></audio>

![Claw-hit peak envelope](/media/guides/claw-wave.png)
