# Sound syntax reference

Sound files use the same `ashfox-model 1` header with one `sound name { … }`
unit. They contain literal synthesis records, not model expressions. There are
no imports, samples, designs, user functions or runtime evaluation.

## Literal grammar

Properties use `name = value;`. Records use `{ name = value; }`; lists use
`[value, value]` or `(value, value)`. Strings use JSON escaping. Numbers use
JSON-style signed decimals and optional exponents, with no unit suffix.
Seconds and hertz are determined by their property, so write `0.5`, not `0.5s`.
Only `//` comments are supported. Duplicate and unknown fields fail.

## Root record

All fields below are required. The declaration supplies `id`, `format` and
`version`; do not repeat those keys in its body.

| Field | Type and accepted range |
| --- | --- |
| `duration` | Seconds, 0.05–5 |
| `sampleRate` | Exactly 48000 |
| `seed` | Integer 1–4294967295 |
| `layers` | 1–8 layer records, unique IDs |
| `variants` | 1–8 `{ id = "base"; seed = 42; }` records, unique IDs |
| `output` | `{ rmsDb = -22; peakDb = -3; }`; RMS -48 to -6 dBFS, peak -12 to -1 dBFS |

The native unit name is an identifier; use lowercase names with underscores.
Layer and variant IDs match `[a-z][a-z0-9_]{0,31}`. Variant selection uses the
variant ID, not a layer ID.

## Layer record

| Field | Type and accepted range |
| --- | --- |
| `id` | Unique layer ID |
| `source` | One discriminated source record below |
| `start` | Seconds, nonnegative |
| `duration` | Seconds, at least 0.02; `start + duration` must fit the sound |
| `gain` | Linear amplitude, 0–2 |
| `attack`, `release` | Seconds, each at least 0.002; their sum must fit the layer |
| `highpass` | Hertz, 10–10000 |
| `lowpass` | Hertz, 20–16000; greater than `highpass` |

All fields are required. Layers are synthesized and mixed on the sound timeline.
The output normalizes toward the RMS target while respecting the peak ceiling;
peak limiting can prevent reaching the requested RMS. A silent result fails.

## Source records

Every field listed for a kind is required; fields from another kind are invalid.

| `kind` | Fields |
| --- | --- |
| `noise` | `kind` only |
| `fm` | `kind`, `pitch`, `sweepSeconds`, `ratio`, `index`, `vibratoHz`, `vibratoCents` |
| `vocal` | `kind`, `pitch`, `sweepSeconds`, `formants`, `bandwidths`, `breath`, `jitter`, `roughness` |

| Parameter | Range |
| --- | --- |
| FM `pitch` | Two endpoints, each 40–3000 Hz |
| Vocal `pitch` | Two endpoints, each 50–1200 Hz |
| `sweepSeconds` | 0.02–5 seconds |
| FM `ratio` | 0.25–4 |
| FM `index` | 0–4 |
| FM `vibratoHz` | 0–25 Hz |
| FM `vibratoCents` | 0–100 cents |
| Vocal `formants` | Exactly three frequencies, each 150–7000 Hz |
| Vocal `bandwidths` | Exactly three values, each 40–1500 Hz |
| Vocal `breath`, `jitter`, `roughness` | Each 0–1 |

## Complete FM tone

Save as `ping.ashfox`:

```ashfox
ashfox-model 1
sound ping {
  duration = 0.3;
  sampleRate = 48000;
  seed = 42;
  layers = [{
    id = "tone";
    source = {
      kind = "fm";
      pitch = [880, 440];
      sweepSeconds = 0.2;
      ratio = 2;
      index = 0.5;
      vibratoHz = 0;
      vibratoCents = 0;
    };
    start = 0;
    duration = 0.3;
    gain = 0.8;
    attack = 0.01;
    release = 0.1;
    highpass = 100;
    lowpass = 6000;
  }];
  variants = [{ id = "base"; seed = 42; }];
  output = { rmsDb = -22; peakDb = -3; };
}
```

```sh
npx --no-install ashfox build ping.ashfox --json
npx --no-install ashfox export ping.ashfox --variant base --output ping.wav
```

Output is mono PCM16 WAV. Seeds make stochastic layers repeatable; changing the
seed of a pure deterministic FM layer can leave its bytes unchanged. OGG is a
separate [delivery option](../guides/game-assets.md), requiring FFmpeg with
libvorbis. See [sound creation and listening](../guides/sounds.md) for noise,
layering, waveform capture and playback examples.
