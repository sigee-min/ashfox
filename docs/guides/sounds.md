# Create and review sounds

Write procedural audio in native `.ashfox` source and compile it with the CLI. Sources output mono or stereo (`channels = 2`) 48 kHz PCM16 WAV with explicit quality `profile`, DSP synthesis, resonant Cytomic SVF filtering, FDN-4 space, pure-CPU audio quality audit, and an 800×520 4-panel `preview inspect { sheet = inspect; }` diagnostic view.

## Author a layered sound

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

## Craft quality and delivery gate

1. **Choose `profile`**: `impact`, `foley`, `creature`, `magic`, `ui`, or `ambient`. `check` scores dynamics/attack, 6-band spectral spread/richness/motion, loudness (`-18..-12` dBFS RMS recommended via `output.gainDb` + `softClip = true`), tail/seam continuity, and variant distinctness (`score >= 75` required for `build`).
2. **Layer timbres**: Pair `resonator` (`mallet` excitation + `pitchDrop`), PolyBLEP unison `osc`, `fm`, `vocal`, or `chirp` tonal cores with swept Cytomic `filter`, `drive` saturation, colored/crackle `noise` transients, stereo `pan`, and `space` reverb tails.
3. **Inspect & listen**: Declare `preview inspect { sheet = inspect; }` and run `ashfox render <file> --view inspect --output sheet.png` for a CPU-rendered 4-panel sheet (`Waveform & Envelope`, `Spectrogram`, `6-Band Spectrum + Audit`, `Variant Overlap`), then audition the built WAV/OGG variants directly.

Named sequence, step and voice IDs own independent random streams. Reordering
records or appending repetitions preserves existing event randomness. Renaming
an ID intentionally changes it. Variation bounds must fit the full timeline,
frequency ranges and resource limits, including outcomes not sampled this time.

## Make a loop

Set `playback = { kind = "loop"; start = 0.4; end = 4.4; crossfade = 0.08; };`
in a source whose raw duration covers that interval. The compiler crops after
warm-up and bakes the overlap once. A four-second interval with 0.08-second
crossfade produces **3.92 seconds**, not four. The playback origin shifts by
the overlap; an intro or outro should be another asset.

WAV contains only PCM, with no embedded loop instruction. Standalone consumers
must enable full-buffer looping. Build receipts and `game_assets` manifests
carry `{ kind: "loop", startFrame: 0, endFrame: frames }`; the game consumer
must honor it. One-shots carry `{ kind: "oneshot" }`.

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

Older `layers`, `attack`, `release`, `contour`, `sweepSeconds`, pitch pairs and
`output.rmsDb` are rejected. Migrate source explicitly; the header remains
`ashfox-model 1`. See [Sound syntax reference](../language/sounds.md) for the complete grammar, loop rules, and resource limits.
