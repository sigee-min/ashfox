# Sound syntax reference

Native sound files use `ashfox 1` followed by `sound name { … }` (or `module name { … }` for reusable voices). Declarations use unified `snake_case` blocks, typed units (`s`, `ms`, `hz`, `khz`, `db`, `lufs`, `cents`, `st`, `%`), `..` ranges, `->` pitch transitions, and unquoted enums with no external audio samples.

## Root contract

All IDs follow `[a-z][a-z0-9_]{0,31}` and are unique within their owner. Required keys must be present unless marked optional; unknown and duplicate keys fail.

| Root field / block | Contract |
| --- | --- |
| `profile` | `impact`, `foley`, `creature`, `magic`, `ui`, or `ambient` |
| `duration` | Raw synthesis seconds, `0.05s..30s` |
| `sample_rate` | Optional `48000` (or `48000hz`) |
| `channels` | Optional `1` (mono, default) or `2` (stereo) |
| `seed` | Integer `1..4294967295` |
| `space { … }` | Optional FDN-8 acoustic reverb (`preset`, `mix`, `decay`, `damping`, `size`, `pre_delay`, `width`) |
| `voice <id> : <kind> { … }` | 1–16 typed voice blocks, each referenced by at least one step |
| `seq <id> { … }` | 1–32 sequence blocks containing `step <id> { … }` declarations |
| `variant <id> { seed = …; }` | 1–8 seeded variant declarations |
| `loop { at = a..b; xfade = …; }` | Optional loop crop range and crossfade (`oneshot` when omitted) |
| `master { gain; peak; … }` | Output mastering (`gain`, `peak`, optional `target`, `punch`, `warmth`, `air`, `glue`, `width`, `limit`) |

## Voices, DSP sources, filters, and envelopes

Each `voice <id> : <kind> { … }` configures a DSP source, optional `highpass`, `lowpass`, `filter <kind> { … }`, `drive` (`0..10`), `pan` (`-1..1`, requires `channels = 2`), and `gain`.

- **Sources (`<kind>`)**:
  - `noise`: `color = white | pink | brown;`.
  - `material`: `material` (`steel`, `iron`, `bronze`, `bell`, `wood`, `stone`, `glass`, `ceramic`, `bone`, `leather`), `pitch` (`20hz..4000hz`), optional `size` (`0.25..4`), `hardness`, `damping`, `brightness` (`0..100%`), `modes` (`4..32`), `strike` (`mallet | scrape | bounce`), `bounces` (`1..6`, requires `strike = bounce`).
  - `granular`: `texture` (`ember`, `gravel`, `water`, `foliage`, `wind`, `spark`, `bubble`), `density` (`1..500`), optional `grain_ms` (`3ms..150ms`), `pitch` (`60hz..12000hz`), `spread`, `burstiness`, `turbulence` (`0..100%`).
  - `osc`: `waveform = sine | triangle | saw | square | pulse;`, `pitch`, optional `pulse_width`, `unison` (`1..4`), `detune` (`0cents..50cents`). PolyBLEP anti-aliased.
  - `fm`: `pitch`, `ratio`, `index`, `vibrato_hz`, `vibrato_cents` (8× oversampled phase-modulation FM).
  - `vocal`: `pitch`, 3–4 `formant { hz = …; bw = …; }` blocks, optional `breath`, `jitter`, `roughness`, `growl`, `chest`, `nasal` (`0..100%`).
  - `chirp`: `pitch`, `brightness`, `trill_hz`, `trill_cents`, `trill_depth`, `breath`, `jitter_cents`.
  - `resonator`: `excitation <kind> { … }` (`impulse`, `noise`, or `mallet`) and `mode <id> { hz; decay; gain; }` blocks, optional `pitch_drop_cents`, `pitch_drop_seconds`.
- **Filters**: `highpass` (`10hz..10000hz`), `lowpass` (`20hz..18000hz`), or Cytomic SVF `filter lowpass|highpass|bandpass|notch { cutoff; q; }`.
- **Curves & envelopes**: Scalar constants, `a -> b` transition sweeps, or `cutoff { domain = linear | log; interpolation = linear | smooth; points = [(0, 12000hz), (1, 2800hz)]; }` curves. Voice `gain` accepts scalar constants or `gain { env = ad | adsr; attack; decay; sustain; release; peak; curve; }` blocks.

## Sequences, steps, variation, and space

Each `seq <id> { … }` has optional `start` (`0s` default) and `repeat { count; period; }`, plus `step <id> { voice; at; duration; }` with optional `gain` (`1`), `pitch` (`0cents`), `vary_timing`, `vary_pitch`, `vary_gain`, and `vary_duration` ranges (`min..max`). Pitch variation on `noise` steps, or `granular` steps without `pitch`, must be zero.

`space { … }` applies an 8-line Hadamard feedback delay network and accepts `preset` (`dry_close | timber_room | stone_hall | small_chamber | courtyard | cavern | ethereal`) and/or `mix` (`0..70%`), `decay` (`30ms..3s`), `damping` (`800hz..16000hz`), `size` (`0.2..3.0`), `pre_delay` (`0ms..80ms`), `width` (`0..1.5`).

`master { … }` shapes the master bus with `gain` (`-48db..24db`), `peak` (`-12db..-0.5db`), optional `target` (`-30lufs..-6lufs`), `punch`, `warmth`, `air`, `glue`, `width`, and `limit = true`.

## Loops, audit, and delivery

`loop { at = 0s..2.1s; xfade = 80ms; }` crops `[start, end)` from raw synthesis and bakes a cosine/Hermite crossfade overlap (`96..min(48000, floor(L/4))` frames), delivering `L - X` frames. Loop OGG and Minecraft pack loop targets remain rejected.

`ashfox check` audits loudness headroom (RMS/LUFS), DC offset, silence ratio, onset punch, 2.5–5 kHz harshness, spectral complexity/balance/flux, stereo phase correlation, loop continuity, and variant distinctness (`score >= 75` required for `build`).

## Complete example

```ashfox
ashfox 1
sound bell_pattern {
  preview inspect { sheet = inspect; }
  profile = ui;
  duration = 2.4s;
  channels = 2;
  seed = 7349;
  space { preset = stone_hall; mix = 28%; }
  voice bell_body : material {
    material = bell;
    pitch = 520hz;
    size = 1.15;
    hardness = 85%;
    damping = 34%;
    brightness = 82%;
    modes = 24;
    strike = mallet;
    filter lowpass {
      cutoff { domain = log; interpolation = smooth; points = [(0, 15000hz), (0.35, 4800hz), (1, 1200hz)]; }
      q = 1.15;
    }
    highpass = 50hz;
    drive = 1.4;
    pan = -0.15;
    gain { env = ad; attack = 2ms; peak = 1; curve = exp; }
  }
  voice shimmer : granular {
    texture = spark;
    density = 95;
    grain_ms = 12ms;
    pitch { domain = log; interpolation = smooth; points = [(0, 8800hz), (1, 1800hz)]; }
    spread = 78%;
    turbulence = 45%;
    highpass = 1400hz;
    pan = 0.25;
    gain { env = ad; attack = 2ms; peak = 0.46; curve = exp; }
  }
  voice bell_sub : resonator {
    excitation mallet { duration = 8ms; hardness = 70%; }
    mode sub { hz = 130hz; decay = 0.36s; gain = 0.9; }
    mode hum { hz = 260hz; decay = 0.34s; gain = 1; }
    mode warm { hz = 390hz; decay = 0.22s; gain = 0.55; }
    pitch_drop_cents = 25cents;
    pitch_drop_seconds = 15ms;
    highpass = 38hz;
    pan = 0.06;
    gain { env = ad; attack = 2ms; peak = 0.85; curve = exp; }
  }
  seq phrase {
    start = 90ms;
    repeat { count = 4; period = 0.5s; }
    step strike { voice = bell_body; at = 0s; duration = 0.34s; vary_timing = -5ms..5ms; vary_pitch = -55cents..55cents; vary_gain = 88%..112%; vary_duration = 95%..105%; }
    step transient { voice = shimmer; at = 0s; duration = 0.16s; vary_pitch = -65cents..65cents; vary_gain = 85%..115%; vary_duration = 85%..115%; }
    step hum { voice = bell_sub; at = 0s; duration = 0.38s; vary_pitch = -55cents..55cents; vary_gain = 90%..110%; }
  }
  variant base { seed = 42; }
  variant alternate { seed = 43; }
  loop { at = 0s..2.1s; xfade = 80ms; }
  master { gain = 5db; peak = -1.5db; target = -12lufs; punch = 25%; air = 20%; glue = 20%; width = 1.1; limit = true; }
}
```

```sh
npx --no-install ashfox check bell_pattern.ashfox
npx --no-install ashfox render bell_pattern.ashfox --view inspect --output bell-sheet.png
npx --no-install ashfox build bell_pattern.ashfox --json
```

See [sound creation and review](../guides/sounds.md) for design workflow and delivery details.
