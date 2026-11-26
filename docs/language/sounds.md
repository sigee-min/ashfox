# Sound syntax reference

Native sound files use `ashfox-model 1` followed by `sound name { … }`. Properties are literal `name = value;` records and lists with no samples, imports, or runtime expressions.

## Root contract

All IDs follow `[a-z][a-z0-9_]{0,31}` and are unique within their owner. Required keys must be present unless marked optional; unknown and duplicate keys fail.

| Root field | Contract |
| --- | --- |
| `profile` | `impact`, `foley`, `creature`, `magic`, `ui`, or `ambient` |
| `duration` | Raw synthesis seconds, `0.05..30` |
| `sampleRate` | Fixed `48000` |
| `channels` | Optional `1` (mono, default) or `2` (stereo) |
| `seed` | Integer `1..4294967295` |
| `space` | Optional FDN-4 acoustic reverb `{ mix, decay, damping, size }` |
| `voices` | 1–16 voice records, each referenced by at least one step |
| `sequences` | 1–32 sequence definitions |
| `variants` | 1–8 `{ id, seed }` records |
| `playback` | `{ kind = "oneshot"; }` or `{ kind = "loop"; start; end; crossfade; }` |
| `output` | `{ gainDb, peakDb }` + optional `softClip` boolean |

## Voices, DSP sources, filters, and envelopes

A voice is `{ id, source, gain }` plus optional `highpass`, `lowpass`, `filter`, `drive` (`0..10`), and `pan` (`-1..1`, requires `channels = 2`).

- **Sources**:
  - `noise`: `{ kind = "noise"; color = "white" | "pink" | "brown" | "crackle"; }` (`color` optional; `crackle` accepts `density` `1..200`).
  - `osc`: `{ kind = "osc"; waveform = "sine" | "triangle" | "saw" | "square" | "pulse"; pitch; }` + optional `pulseWidth`, `unison` (`1..7`), `detuneCents`. PolyBLEP anti-aliased.
  - `fm`: `{ kind = "fm"; pitch; ratio; index; vibratoHz; vibratoCents; }` (8× oversampled phase-modulation FM).
  - `vocal`: `{ kind = "vocal"; pitch; formants; bandwidths; breath; jitter; roughness; }`.
  - `chirp`: `{ kind = "chirp"; pitch; brightness; trillHz; trillCents; trillDepth; breath; jitterCents; }`.
  - `resonator`: `{ kind = "resonator"; excitation; modes; }` + optional `pitchDropCents`, `pitchDropSeconds`. `excitation` supports `{ kind = "impulse"; }`, `{ kind = "noise"; duration; }`, or `{ kind = "mallet"; duration; hardness; }`.
- **Filters**: `highpass` (`10..10000` Hz), `lowpass` (`20..18000` Hz), or parametric Cytomic SVF `filter = { kind = "lowpass" | "highpass" | "bandpass" | "notch"; cutoff; q; }`.
- **Curves & envelopes**: Scalar constants or `{ domain = "linear" | "log"; interpolation = "linear" | "smooth"; points = [...]; }` curves (`2..16` points, `>= 96` frame knot spacing). Voice `gain` also accepts envelope shorthands:
  - `{ env = "ad"; attack; peak; curve; }` (`peak`, `curve` optional)
  - `{ env = "adsr"; attack; decay; sustain; release; peak; curve; }`

## Sequences, steps, variation, and space

Each sequence has `{ id, start, steps }` and optional `repeat` (`start` and `repeat` optional; `start` defaults to `0`, `repeat` defaults to `{ count = 1; period = 0; }`).
Each step has `{ id, voice, at, duration }` + optional `gain` (`1`), `pitchCents` (`0`), and `vary` (`timing`, `pitchCents`, `gain`, `duration`). Pitch variation on `noise` steps must be `0`.

`space = { mix; decay; damping; size; }` applies a feedback delay network (`mix` `0..0.6`, `decay` `0.03..1.5`s, `damping` `1000..14000` Hz, `size` `0.2..2`).

`output.softClip = true;` engages smooth `tanh` soft-knee limiting into `output.peakDb` (`-12..-1` dBFS); default `false` enforces strict linear ceiling checks on PCM16 rounding.

## Loops, audit, and delivery

Loops crop `[start, end)` from raw synthesis and bake a smooth cosine/Hermite overlap `crossfade` (`96..min(48000, floor(L/4))` frames), delivering `L - X` frames with `{ kind = "loop"; startFrame = 0; endFrame = frames; }`. Loop OGG and Minecraft pack loop targets remain rejected.

`ashfox check` audits loudness headroom, DC offset, silence ratio, spectral complexity/balance/flux, loop continuity, and variant distinctness (`score >= 75` required for `build`).

## Complete example

```ashfox
ashfox-model 1
sound bell_pattern {
  preview inspect { sheet = inspect; }
  profile = "ui";
  duration = 2.4;
  sampleRate = 48000;
  channels = 2;
  seed = 7349;
  space = { mix = 0.24; decay = 0.42; damping = 6200; size = 0.9; };
  voices = [{
    id = "bell_body";
    source = {
      kind = "resonator";
      excitation = { kind = "mallet"; duration = 0.008; hardness = 0.78; };
      modes = [
        { id = "sub"; hz = 320; decay = 0.45; gain = 0.65; },
        { id = "body"; hz = 640; decay = 0.38; gain = 1.0; },
        { id = "tier"; hz = 1280; decay = 0.26; gain = 0.55; },
        { id = "edge"; hz = 1730; decay = 0.18; gain = 0.42; },
        { id = "spark"; hz = 4200; decay = 0.09; gain = 0.24; }
      ];
      pitchDropCents = 25;
      pitchDropSeconds = 0.015;
    };
    filter = {
      kind = "lowpass";
      cutoff = { domain = "log"; interpolation = "smooth"; points = [{ at = 0; value = 12000; }, { at = 1; value = 2800; }]; };
      q = 1.1;
    };
    highpass = 60;
    pan = -0.15;
    gain = { env = "ad"; attack = 0.002; peak = 1.05; curve = "exp"; };
  }, {
    id = "shimmer";
    source = { kind = "noise"; color = "white"; };
    filter = {
      kind = "bandpass";
      cutoff = { domain = "log"; interpolation = "smooth"; points = [{ at = 0; value = 9500; }, { at = 1; value = 2200; }]; };
      q = 1.6;
    };
    pan = 0.25;
    gain = { env = "ad"; attack = 0.002; peak = 0.32; curve = "exp"; };
  }];
  sequences = [{
    id = "phrase";
    start = 0.09;
    repeat = { count = 4; period = 0.5; };
    steps = [
      { id = "strike"; voice = "bell_body"; at = 0; duration = 0.46; vary = { timing = [-0.005, 0.005]; pitchCents = [-35, 35]; gain = [0.9, 1.1]; duration = [0.95, 1.05]; }; },
      { id = "transient"; voice = "shimmer"; at = 0; duration = 0.12; vary = { gain = [0.85, 1.15]; duration = [0.85, 1.15]; }; }
    ];
  }];
  variants = [{ id = "base"; seed = 42; }, { id = "alternate"; seed = 43; }];
  playback = { kind = "loop"; start = 0; end = 2.1; crossfade = 0.08; };
  output = { gainDb = 19; peakDb = -2; softClip = true; };
}
```

```sh
npx --no-install ashfox check bell_pattern.ashfox
npx --no-install ashfox render bell_pattern.ashfox --view inspect --output bell-sheet.png
npx --no-install ashfox build bell_pattern.ashfox --json
```

See [sound creation and review](../guides/sounds.md) for design workflow and delivery details.
