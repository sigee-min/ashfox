# Create and review sounds

Write procedural audio in native `.ashfox` source and compile it with the CLI. Sources output mono or stereo (`channels = 2`) 48 kHz PCM16 WAV with explicit quality `profile`, physical `material` & `granular` DSP synthesis, resonant Cytomic SVF filtering, FDN-8 space presets, perceptual mastering (`target`, `punch`, `warmth`, `air`, `glue`, `width`, `limit`), pure-CPU perceptual audio audit, and an 800×520 4-panel `preview inspect { sheet = inspect; }` diagnostic view.

## Author a layered sound

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

## Craft quality and delivery gate

1. **Choose `profile`**: `impact`, `foley`, `creature`, `magic`, `ui`, or `ambient`. `check` scores dynamics/onset punch/attack, 6-band spectral spread/harshness/richness/motion, perceptual loudness (`-18..-12` LUFS recommended via `master.gain`, `target`, and `limit = true`), stereo phase correlation, tail/seam continuity, and variant distinctness (`score >= 75` required for `build`).
2. **Layer timbres**: Pair `material` (`steel`, `wood`, `stone`, `glass`, etc. with `mallet`/`scrape`/`bounce`), `granular` (`ember`, `gravel`, `water`, `foliage`, `wind`, `spark`, `bubble`), `resonator`, PolyBLEP unison `osc`, `fm`, `vocal` (with `growl`/`chest`/`nasal` and `formant` curves), or `chirp` cores with swept Cytomic `filter`, `drive` saturation, colored `noise` transients, stereo `pan`, and `space` (`preset` or custom FDN-8) tails.
3. **Inspect & listen**: Declare `preview inspect { sheet = inspect; }` and run `ashfox render <file> --view inspect --output sheet.png` for a CPU-rendered 4-panel sheet (`Waveform & Envelope`, `Spectrogram`, `6-Band Spectrum + Audit`, `Variant Overlap`), then audition the built WAV/OGG variants directly.

Named `seq`, `step`, and `voice` IDs own independent random streams. Reordering
blocks or appending repetitions preserves existing event randomness. Renaming
an ID intentionally changes it. Variation bounds must fit the full timeline,
frequency ranges and resource limits, including outcomes not sampled this time.

## Make a loop

Set `loop { at = 0.4s..4.4s; xfade = 80ms; }`
in a source whose raw duration covers that interval. The compiler crops after
warm-up and bakes the overlap once. A four-second interval with 0.08-second
crossfade produces **3.92 seconds**, not four. The playback origin shifts by
the overlap; an intro or outro should be another asset.

WAV contains only PCM, with no embedded loop instruction. Standalone consumers
must enable full-buffer looping. Build receipts and `game_assets` manifests
carry `{ kind = "loop", startFrame: 0, endFrame: frames }`; the game consumer
must honor it. One-shots carry `{ kind = "oneshot" }`.

Loop OGG and Minecraft delivery are rejected because those paths cannot preserve
the exact loop contract. One-shot OGG uses the built-in WebAssembly Vorbis
encoder with no external tools required.

## Listen and inspect

Compare variants at the intended output volume, then compare timbre with matched
loudness. Hear an entire phrase and at least 20 loop cycles. Listen for clicks,
unnatural repetition, harsh upper harmonics and a dip during crossfade. Check
waveform, seam delta, adjacent slopes and spectrogram alongside listening;
measurements cannot establish animal or material realism.

The repository's `examples/sounds/assets/` contains bird phrases (`bird_call.ashfox` with modular `bird_voices.ashfox`), footsteps, charging
spell, modal metal/wood/glass studies and wind/fire/mechanical loops. These are
procedural studies requiring audition, not recordings or realism guarantees.
`bell_pattern.ashfox` exercises all features together.

Use the unified `ashfox 1` sound syntax in [Sound syntax reference](../language/sounds.md) for the complete grammar, loop rules, and resource limits.
