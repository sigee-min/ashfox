# Sound syntax reference

Native sound files use `ashfox 1` followed by `sound name { … }` or `module name { … }`. The language uses declarative `snake_case` blocks, unquoted enums, and unit-typed statements with no samples or runtime expressions.

## Root contract

All IDs follow `[a-z][a-z0-9_]{0,31}` and are unique within their owner. Unknown, `camelCase`, and duplicate fields fail; legacy `ashfox-model 1` headers, JSON array syntax (`voices = [...]`, `sequences = [...]`, bracketed `{ domain = ...; }`), `timeline`, and `resonator` are rejected.

| Declaration / field | Contract |
| --- | --- |
| `profile` | `impact`, `foley`, `creature`, `magic`, `ui`, or `ambient` |
| `duration` | Raw synthesis duration, `0.05s..30s` |
| `sample_rate` | Optional; fixed `48000hz` (default `48000hz`) |
| `channels` | Optional `1` (mono) or `2` (stereo, default `2`) |
| `seed` | Integer `1..4294967295` |
| `variants` | Optional `{ id = seed; ... }`; defaults to 2 variants (`base` = `seed`, `alternate` = `seed ^ 0x9e3779b9`) |
| `space` | Optional FDN-8 true-stereo reverb: `space { [preset = <preset>;] [mix = ...;] [decay = ...;] [damping = ...;] [size = ...;] [pre_delay_ms = ...;] [width = ...;] }` |
| `voice <id> : <type> { ... }` | 1–16 voices, each referenced by at least one `seq` step or `duck` |
| `seq <id> { ... }` | 1–32 sequences (`start = ...;`, `repeat { count = ...; period = ...; }`, `step <id> { ... }`) |
| `loop` | Optional `loop { at = <start>..<end>; [xfade = <dur>;] }` (or `playback = oneshot;`, default `oneshot`) |
| `master` | `master { [gain = <db>;] [target = <lufs>;] peak = <db>; [punch = ...;] [warmth = ...;] [air = ...;] [glue = ...;] [width = ...;] [limit = true;] }` |

## Units, curves, envelopes, and modules

- **Units**: `ms` (milliseconds), `s` (seconds), `hz` / `khz` (frequency), `db` (decibels), `lufs` (loudness), `cents` / `st` (pitch offset), `%` (percentage scaled to `0.01`).
- **Transitions & curves**: `log(0: 1800hz -> 1: 950hz)`, `lin(0: 0 -> 0.5: 1 -> 1: 0)`, `smooth(0: 200hz -> 1: 800hz)`, or inline `a -> b [ease_out -> c]` transitions (`linear`/`smooth`/`ease_in`/`ease_out`/`ease_in_out`/`snap`). Curves support `2..16` knots with `>= 96` frames separation.
- **Envelopes**: `gain { env = ad; attack = 5ms; peak = 0.95; curve = exp; }` and `gain { env = adsr; attack = 20ms; decay = 120ms; sustain = 0.7; release = 150ms; peak = 0.9; curve = exp; }`.
- **Modules & `params`**: Modules declare `params { key = val; }` and `export voice <id> : <type> { ... }` (or `export seq <id> { ... }`). Sound files import relative modules (`import "../module/kit.ashfox" as kit;`) or built-in standard-library modules (`import "std/sound/combat/blade" as blade;`) at the top of the block, optionally overriding params (`{ pitch = 440hz; }`), and reference voices as `alias.voice_id`.

## Voices, true-stereo sources, FX, and modulation

Inside `voice <id> : <type> { ... }`, declare source fields, a `gain` block or curve, and optional processors:

- **Source types (`:<type>`)**:
  - `: noise` — `color = white|pink|brown;` (decorrelated stereo noise in 2ch mode).
  - `: material` / `: modal_plate` — `material = <preset>; pitch = <ctrl>; [size] [hardness] [damping] [brightness] [modes] [strike = mallet|scrape|bounce] [bounces] [twin_beat] [splash] [stereo_spread]` (`steel`, `iron`, `bronze`, `bell`, `wood`, `stone`, `glass`, `ceramic`, `bone`, `leather`; `pitch` `20..4000` Hz).
  - `: granular` — `texture = <preset>; density = <ctrl>; [grain_ms] [pitch] [spread] [burstiness] [turbulence] [stereo_width] [itd_ms]` (`ember`, `gravel`, `water`, `foliage`, `wind`, `spark`, `bubble`; `itd_ms` `0..0.6` ms).
  - `: osc` — `waveform = sine|triangle|saw|square|pulse; pitch = <ctrl>; [pulse_width] [unison = 1..4] [detune_cents]` (PolyBLEP + stereo unison spread).
  - `: fm` — `pitch = <ctrl>; ratio = <0.25..8>; index = <ctrl>; [vibrato_hz] [vibrato_cents]`.
  - `: vocal` — `pitch = <ctrl>; [vowels = oo -> aa -> uh;] [formants = [...];] [bandwidths = [...];] [breath] [jitter] [roughness] [growl] [chest] [nasal] [rattle]` (LF glottal derivative + cascade 4-formant filter).
  - `: chirp` — `pitch = <ctrl>; brightness = <ctrl>; [trill_hz] [trill_cents] [trill_depth] [breath] [jitter_cents]`.
  - `: whoosh` / `: aero_whoosh` — `[velocity = <ctrl>;] [thickness] [doppler] [sweep_pan] [noise_tone]` (velocity-cubed aerodynamic pressure, Strouhal vortex whistle, Doppler shift, and stereo sweep; `aero_whoosh` defaults `velocity = 1.2`).
  - `: waveguide` — `model = string|blade|creak|pipe; pitch = <ctrl>; [damping] [stiffness] [bow_pressure] [brightness]` (dispersive fractional-delay physical waveguide).
- **Filters & EQ**: `highpass = <ctrl>;`, `lowpass = <ctrl>;`, `filter : <lowpass|highpass|bandpass|notch> { cutoff = <ctrl>; [q = <ctrl>;] }` (or inline `cutoff = <ctrl>; [q = <ctrl>;]` for bandpass), `eq { [low = (hz, db);] [mid = (hz, db, q);] [high = (hz, db);] }`.
- **Drive & FX**: `drive : <tape|tube|grit|fold> { amount = <0..10>; }` (or `drive = <0..10>;`), repeatable `fx : <chorus|phaser|delay|shimmer> { ... }` (`time_ms`, `ping_pong`, `shift_semitones`, `damping = <hz>`), `pan = <ctrl>;` (`-1..1`), `duck { by = <voice>; amount = <0..1>; release_ms = <5..2000ms>; }`, `drift { target = <gain|cutoff|pitch|pan>; depth = <0..1>; [rate = <0.05..20hz>;] [seed = <int>;] }`.

## Sequences, space, loops, and audit

Each `seq <id> { ... }` contains optional `start = <dur>;`, `repeat { count = <N>; period = <dur>; }`, and `step <id> { voice = <voiceRef>; at = <dur>; duration = <dur>; [gain = ...;] [pitch = <cents>;] [vary_timing = a..b;] [vary_pitch = a..b;] [vary_gain = a..b;] [vary_duration = a..b;] }`.

`space` accepts `preset` (`dry_close`, `timber_room`, `stone_hall`, `small_chamber`, `courtyard`, `cavern`, `ethereal`) or custom true-stereo FDN-8 parameters (`mix` `0..0.7`, `decay` `0.03..3s`, `damping` `800..16000hz`, `size` `0.2..3`, `pre_delay_ms` `0..80ms`, `width` `0..1.5`).

Loops crop `[start, end)` and bake a smooth cosine/Hermite overlap `xfade` (`96..min(48000, floor(L/4))` frames). `ashfox check` audits headroom, DC offset, silence ratio, profile spectral envelope fit, stereo phase & IACC decorrelation, loop seam continuity & periodicity, and variant distinctness (`score >= 75` required for `build`).

## Complete example

```ashfox
ashfox 1
sound bell_pattern {
  preview inspect { sheet = inspect; }
  profile = ui;
  duration = 2.4s;
  seed = 7349;
  space { preset = stone_hall; mix = 28%; }

  voice bell_body : modal_plate {
    material = bell;
    pitch = 520hz;
    size = 1.15;
    hardness = 0.85;
    damping = 0.34;
    brightness = 0.82;
    modes = 16;
    strike = mallet;
    twin_beat = 0.55;
    splash = 0.28;
    stereo_spread = 0.5;
    highpass = 65hz;
    filter : lowpass { cutoff = log(0: 15000hz -> 0.35: 4800hz -> 1: 1400hz); q = 1.15; }
    eq { mid = (1800hz, 2.5db, 1.0); high = (5800hz, 2db); }
    drive : tape { amount = 1.4; }
    pan = -0.15;
    gain { env = ad; attack = 2ms; peak = 1.0; curve = exp; }
  }

  voice shimmer : granular {
    texture = spark;
    density = 95;
    grain_ms = 12ms;
    pitch = log(0: 8800hz -> 1: 1800hz);
    spread = 0.78;
    turbulence = 0.45;
    stereo_width = 0.85;
    itd_ms = 0.28ms;
    highpass = 1400hz;
    fx : shimmer { mix = 16%; feedback = 22%; shift_semitones = 12st; }
    pan = 0.25;
    gain { env = ad; attack = 2ms; peak = 0.52; curve = exp; }
  }

  voice bell_sub : material {
    material = bronze;
    pitch = 260hz;
    size = 1.3;
    hardness = 0.68;
    damping = 0.36;
    brightness = 0.58;
    modes = 8;
    strike = mallet;
    twin_beat = 0.35;
    stereo_spread = 0.3;
    highpass = 60hz;
    lowpass = 1800hz;
    eq { low = (220hz, 1.5db); }
    pan = 0.06;
    gain { env = ad; attack = 2ms; peak = 0.68; curve = exp; }
  }

  seq phrase {
    start = 90ms;
    repeat { count = 4; period = 500ms; }
    step strike { voice = bell_body; at = 0s; duration = 340ms; vary_timing = -5ms..5ms; vary_pitch = -55cents..55cents; vary_gain = 88%..112%; vary_duration = 95%..105%; }
    step transient { voice = shimmer; at = 0s; duration = 160ms; vary_pitch = -65cents..65cents; vary_gain = 85%..115%; vary_duration = 85%..115%; }
    step hum { voice = bell_sub; at = 0s; duration = 380ms; vary_pitch = -55cents..55cents; vary_gain = 90%..110%; }
  }

  variants { base = 42; alternate = 43; }
  loop { at = 0s..2.1s; xfade = 80ms; }
  master { gain = 5db; target = -12lufs; peak = -1.5db; punch = 25%; air = 20%; glue = 20%; width = 1.1; limit = true; }
}
```

```sh
npx --no-install ashfox check bell_pattern.ashfox
npx --no-install ashfox render bell_pattern.ashfox --view inspect --output bell-sheet.png
npx --no-install ashfox build bell_pattern.ashfox --json
```

See [sound creation and review](../guides/sounds.md) for design workflow and delivery details.
