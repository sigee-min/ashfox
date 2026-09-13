# Create and review sounds

Write procedural audio in native `.ashfox` source and compile it with the CLI.
The source owns synthesis, reusable voices, event timing, bounded variation,
fixed loudness and playback intent. Output is mono PCM16 WAV at 48 kHz.

## Author a voice and phrase

Start with the complete [sound syntax example](../language/sounds.md). A `voice`
contains a noise, FM, vocal, chirp or resonator source plus gain and filters.
A `sequence` places named steps and repeats them a finite number of times.
Every step explicitly supplies timing, pitch, gain and duration variation ranges.
Zero ranges and `[1, 1]` multipliers disable variation.

Use scalar controls for constants and shared curves for pitch, gain, cutoff,
FM index and chirp brightness. Curve time runs from 0 to 1 within each event.
Smooth interpolation eases into every knot; log-domain interpolation is useful
for frequency. One-shot gain curves must start and end at zero; no hidden fade
or automatic normalization corrects the result.

```ashfox
ashfox-model 1
sound bell_pattern {
  duration = 2.4;
  sampleRate = 48000;
  seed = 7349;
  voices = [{
    id = "bell";
    source = {
      kind = "resonator";
      excitation = { kind = "impulse"; };
      modes = [
        { id = "body"; hz = 640; decay = 0.35; gain = 1; },
        { id = "edge"; hz = 1730; decay = 0.18; gain = 0.35; }
      ];
    };
    gain = {
      domain = "linear";
      interpolation = "smooth";
      points = [
        { at = 0; value = 0; },
        { at = 0.01; value = 0.8; },
        { at = 0.7; value = 0.5; },
        { at = 1; value = 0; }
      ];
    };
    highpass = 80;
    lowpass = {
      domain = "log";
      interpolation = "smooth";
      points = [{ at = 0; value = 8000; }, { at = 1; value = 3000; }];
    };
  }];
  sequences = [{
    id = "phrase";
    start = 0.1;
    repeat = { count = 4; period = 0.5; };
    steps = [{
      id = "strike";
      voice = "bell";
      at = 0;
      duration = 0.4;
      gain = 1;
      pitchCents = 0;
      vary = {
        timing = [-0.005, 0.005];
        pitchCents = [-20, 20];
        gain = [0.9, 1.1];
        duration = [0.95, 1.05];
      };
    }];
  }];
  variants = [{ id = "base"; seed = 42; }, { id = "alternate"; seed = 43; }];
  playback = { kind = "loop"; start = 0; end = 2.1; crossfade = 0.08; };
  output = { gainDb = -6; peakDb = -3; };
}
```

```sh
npx --no-install ashfox inspect bell_pattern.ashfox
npx --no-install ashfox build bell_pattern.ashfox --json
npx --no-install ashfox export bell_pattern.ashfox --variant base --output bell.wav
```

## Choose levels and variation

`output.gainDb` is a fixed multiplier for every variant. `peakDb` is a rejection
ceiling, not a limiter. Lower gain when the compiler reports excess peak; leave
headroom for PCM16 rounding. Changing the seed does not guarantee different
bytes for a deterministic voice with all variation disabled.

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
the exact loop contract. One-shot OGG still requires FFmpeg with libvorbis.
The audio study plays loop WAV directly and offers no OGG download for it.

## Listen and inspect

Compare variants at the intended output volume, then compare timbre with matched
loudness. Hear an entire phrase and at least 20 loop cycles. Listen for clicks,
unnatural repetition, harsh upper harmonics and a dip during crossfade. Check
waveform, seam delta, adjacent slopes and spectrogram alongside listening;
measurements cannot establish animal or material realism.

The repository's `examples/sounds/src` contains bird phrases, footsteps, charging
spell, modal metal/wood/glass studies and wind/fire/mechanical loops. These are
procedural studies requiring audition, not recordings or realism guarantees.
`bell_pattern.ashfox` exercises all five features together.

Older `layers`, `attack`, `release`, `contour`, `sweepSeconds`, pitch pairs and
`output.rmsDb` are rejected. Migrate source explicitly; the header remains
`ashfox-model 1`. Use the installed CLI's sound contract fingerprint to check
that the executable and source reference agree.
