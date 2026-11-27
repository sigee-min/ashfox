# Create and review sounds

Write procedural audio in native `.ashfox` source (`ashfox 1`) and compile it with the CLI. Sources default to true-stereo (`channels = 2`) 48 kHz PCM16 WAV with explicit quality `profile`, physical `material`/`modal_plate`, `granular`, `whoosh`/`aero_whoosh`, `waveguide`, and cascade LF-glottal `vocal` synthesis, per-voice `eq`/`drive`/`fx`/`duck`/Perlin `drift`, true-stereo FDN-8 `space`, perceptual `master` (`target` LUFS, `punch`, `warmth`, `air`, `glue`, `width`, `limit`), pure-CPU quality audit, and an 800×520 4-panel `preview inspect { sheet = inspect; }` diagnostic view.

## Author a layered sound

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

## Craft quality and delivery gate

1. **Choose `profile`**: `impact`, `foley`, `creature`, `magic`, `ui`, or `ambient`. `check` scores dynamics/onset punch/attack, profile-specific 6-band spectral fit/harshness/richness/motion, perceptual loudness (`-18..-12` LUFS recommended via `master { gain = ...; target = ...; limit = true; }`), stereo phase & IACC decorrelation, loop seam/periodicity, and variant distinctness (`score >= 75` required for `build`).
2. **Layer timbres & dynamics**: Pair `material`/`modal_plate` (with `twin_beat`/`splash`/`stereo_spread`), `granular` (`stereo_width`/`itd_ms`), `whoosh`/`aero_whoosh`, `waveguide` (`string`/`blade`/`creak`/`pipe`), `vocal` (LF glottal + cascade formants/vowels + `rattle`), PolyBLEP stereo `osc`, `fm`, or `chirp` with `eq`, `drive` (`tape`/`tube`/`grit`/`fold`), `fx` (`chorus`/`phaser`/`delay`/`shimmer`), `duck`, circular Perlin `drift`, dynamic `pan`, and true-stereo `space`.
3. **Inspect & listen**: Declare `preview inspect { sheet = inspect; }` and run `ashfox render <file> --view inspect --output sheet.png` for the 4-panel sheet (`Waveform & Envelope`, `Spectrogram`, `6-Band Spectrum + Audit`, `Variant Overlap`), then audition the built WAV/OGG variants directly.

Named `seq`, `step`, and `voice` IDs own independent deterministic random streams. Variation bounds must fit the full timeline, frequency ranges, and resource limits, including outcomes not sampled in a single run.

## Make a loop

Declare `loop { at = 0.4s..4.4s; xfade = 80ms; }` in a source whose raw `duration` covers that interval. The compiler crops after warm-up and bakes the overlap once. A four-second interval with 80ms crossfade delivers **3.92 seconds**. Use circular Perlin `drift` and subtle granular turbulence on ambient loops so the Loop Periodicity Detector sees organic evolution rather than static LFO swells.

WAV contains only PCM, with no embedded loop instruction. Standalone consumers must enable full-buffer looping. Build receipts and `game_assets` manifests carry `{ kind = "loop", startFrame: 0, endFrame: frames }`; one-shots carry `{ kind = "oneshot" }`. When `game_assets` packs use `audio: "ogg"`, loops embed `LOOPSTART` and `LOOPLENGTH` Vorbis comments and emit `loopStartSample`, `loopEndSample`, and `sampleRate` in `assets.json` for gapless playback. Minecraft pack loop targets remain rejected.

## Listen and inspect

Compare variants at intended output volume, then compare timbre at matched loudness. Audition at least 20 loop cycles for clicks, repetitive swells, harsh upper harmonics, or crossfade dips.

The repository's `showcase/assets/sounds/` and built-in standard library (`ashfox library std list sound`) include blade/hit combat sounds (`sword_slash.ashfox`, `claw_hit.ashfox`), sci-fi energy weapons (`energy.ashfox`), footsteps (`footsteps.ashfox`), creature calls (`griffin_call.ashfox`), storm ambience (`storm.ashfox`), and gapless loops (`fire_loop.ashfox`), alongside `std/sound/{weapon,mech,creature,weather}/*` modules.

Legacy headers (`ashfox-model 1`), JSON array syntax (`voices = [...]`, `sequences = [...]`, `{ domain = ...; }`), `camelCase` keys, quoted enum strings, `timeline`, `resonator`, `layers`, `output.rmsDb`, `output.softClip`, and `noise.color = "crackle"` are rejected. See [Sound syntax reference](../language/sounds.md) for the complete `ashfox 1` sound grammar and resource limits.
