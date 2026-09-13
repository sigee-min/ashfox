# Sound syntax reference

Native sound files use `ashfox-model 1` followed by `sound name { … }`.
Properties are literal `name = value;` records and lists. There are no samples,
imports, expressions or runtime evaluation. Unknown and duplicate keys fail.
The current contract hard-cuts the former layer grammar.

## Root contract

Retain the native literal grammar (`field = value;`, records, lists, strings,
finite numbers and comments). No expressions or implicit symbol evaluation.
References such as `voice = "whistle"` are exact local IDs. All keys below are
required unless explicitly marked optional; unknown and duplicate keys fail.
All IDs follow `[a-z][a-z0-9_]{0,31}` and are unique within their owner. Root ID
comes from the declaration and follows this rule too.

| Root field | Contract |
| --- | --- |
| `duration` | Raw synthesis seconds, 0.05–30; finite, not inferred from events |
| `sampleRate` | Exactly 48000 |
| `seed` | Integer 1–4294967295 |
| `voices` | 1–16 definitions, each referenced by at least one step |
| `sequences` | 1–32 sequence definitions |
| `variants` | 1–8 `{ id, seed }` records; existing seed integer range |
| `playback` | `{ kind = "oneshot"; }` or `{ kind = "loop"; start; end; crossfade; }` |
| `output` | `{ gainDb, peakDb }`; fixed gain -48..24 dB and ceiling -12..-1 dBFS |

A voice is `{ id, source, gain, highpass, lowpass }`. Gain is linear amplitude
0..2; highpass 10..10000 Hz, lowpass 20..16000 Hz. These three controls accept
curves. A voice owns no timeline, random seed, attack, release or duration.
Duration belongs to each scheduled instance. Source-specific amplitudes such
as breath are synthesis controls; voice gain is the one articulation envelope.

## 1. Common parameter curves

A control is either a numeric constant or the exact record below:

```text
pitch = {
  domain = "log";
  interpolation = "smooth";
  points = [
    { at = 0; value = 2800; },
    { at = 0.35; value = 5400; },
    { at = 1; value = 3200; }
  ];
};
```

`domain` is `linear` or `log`; `interpolation` is `linear` or `smooth`.
There are 2–16 points, with strictly increasing `at`, exactly starting at 0
and ending at 1. `at` is normalized instance time, not root time or seconds.
Each curve interval must occupy at least 96 frames at the shortest possible
instance duration. Validate this after duration-range analysis. Duplicate or
collapsed knots fail; never sort, merge, or invent endpoint knots.

For an N-frame instance, evaluate u=i/(N-1), i=0..N-1. For segment endpoints a,b,
v=(u-a.at)/(b.at-a.at); interpolation weight is v or v*v*(3-2*v).
Interpolate values directly in linear domain, or interpolate their logarithms
and exponentiate in log domain. Log values must be strictly positive. Smooth
has zero slope at each knot and no overshoot; it is not a spline with hidden
tangents. Values retain their parameter's bounds for the entire segment.

| Control | Accepted representation and range |
| --- | --- |
| Voice `gain` | Scalar/curve, 0..2; only linear domain (zero is meaningful) |
| Voice `highpass`, `lowpass` | Scalar/curve, ranges above; either domain |
| FM `pitch` | Scalar/curve, 40..3000 Hz; either domain |
| FM `index` | Scalar/curve, 0..4; linear domain |
| Vocal `pitch` | Scalar/curve, 50..1200 Hz; either domain |
| Chirp `pitch` | Scalar/curve, 500..8000 Hz; either domain |
| Chirp `brightness` | Scalar/curve, 0..1; linear domain |
| Resonator modal frequency/decay | Constants only; see resonance section |
| All other source fields | Constants with current ranges; curves rejected |

FM keeps `ratio`, `vibratoHz`, `vibratoCents`; vocal keeps `formants`,
`bandwidths`, `breath`, `jitter`, `roughness`; chirp keeps `trillHz`,
`trillCents`, `trillDepth`, `breath`, `jitterCents`. Noise has only `kind`.
These are complete discriminated source key sets together with controls in
the table and `kind`. `sweepSeconds`, two-element `pitch`, and `contour` are rejected.
FM/vocal/chirp source implementations consume the same evaluated pitch control.

Filtering remains highpass then lowpass with the existing one-pole recurrences;
recalculate their stable coefficients at each sample from evaluated cutoff Hz.
Validate max(highpass) < min(lowpass) over the full curves. This conservative
rule deliberately rejects overlapping cutoff ranges even if their pointwise
trajectories never cross; it avoids accepting a relation only some instances
satisfy. The diagnostic explains how to separate the ranges.

`attack` and `release` are rejected. Authors express attack, sustain and release as
voice gain curves. No hidden fade is applied. One-shots must begin and end with
voice gain zero for every event, enforced on curve endpoints; a scalar zero
voice is valid structurally but a silent final product fails. Loop events may
use nonzero endpoints only when that endpoint lies outside or exactly on the
raw loop boundaries; an onset or termination strictly inside the loop region
still requires zero gain. That permits continuous wind while preventing abrupt
internal cuts. At least 96-frame knot separation bounds envelope transitions.
Resonator decay does not exempt an event from the envelope endpoint rule.

## 2. Reuse, repetition and sequences

Each sequence is `{ id, start, repeat, steps }`:

- `start`: nonnegative seconds from raw sound start.
- `repeat`: `{ count, period }`; count integer 1..64. For count=1 period must
  equal 0; otherwise period is positive seconds, at least one output frame.
- `steps`: 1..32 `{ id, voice, at, duration, gain, pitchCents, vary }` records.
  `at` is a nonnegative seconds offset from each iteration's start. Duration
  is 0.02..30 seconds; gain is 0..2, pitchCents is -1200..1200.
- `vary`: the explicit variation record below. No optional silent defaults.

For sequence iteration k and step s, the nominal onset is
`sequence.start + k*period + s.at`. Each step starts its own oscillator,
filters, modulation phases and envelope. Overlap is permitted and summed,
including across repetitions. A sequence has no automatic duration, tail
extension, nested repetition, voice recursion, or tempo. `period` measures
start-to-start spacing, not silence after the previous voice. Silent padding
comes from root duration. Instances must fit; there is no truncation.

Each instance identity is `(sequence.id, k, step.id, voice.id)`. Sort mix order
lexically by sequence ID, numerically by k, then lexically by step ID. Source
list reordering never changes sample summation or random assignments. Renaming
an ID intentionally changes stochastic identity. Editing a voice updates all
references. Repetition count changes do not alter existing instances.

## 3. Controlled random variation

Each step supplies exactly these four range records, with numeric endpoints:

```text
vary = {
  timing = [-0.008, 0.008];
  pitchCents = [-25, 25];
  gain = [0.92, 1.08];
  duration = [0.96, 1.04];
};
```

The no-variation value is `{ timing = [0,0]; pitchCents = [0,0];
gain = [1,1]; duration = [1,1]; }`. Endpoints are inclusive support bounds,
min<=max; degenerate ranges do not draw RNG. Uniform sampling uses U in [0,1),
`min + (max-min)*U`. No Gaussian tails, correlated humanize switch, random
knot positions, probability of omission, or arbitrary field-path modulation.

| Dimension | Range limits | Operation |
| --- | --- | --- |
| `timing` | -0.5..0.5 seconds | Add to nominal onset; independent per instance, not accumulated interval drift |
| `pitchCents` | -1200..1200 | Add to step pitchCents, multiply source pitch by 2^(cents/1200) |
| `gain` | 0..2 | Multiply step gain then voice gain; combined gain <=4 |
| `duration` | 0.25..4 | Multiply step duration before frame conversion; stretches control time but not pitch |

Pitch shift applies to FM/vocal/chirp fundamental or all resonator modes; it
does not move vocal formants, filters or modulation rates. Noise steps must
use pitchCents=0 and vary.pitchCents=[0,0]. Random timing is relative to the
nominal onset: it may reorder or overlap events, but never reorder their sum.
Per-instance shifts are separate from within-note trill/jitter.

Validation proves the entire Cartesian support of these ranges is legal,
not merely the chosen seeds: earliest onset >=0, latest end <=raw duration,
minimum duration >=0.02, curve resolution, envelope boundary rule, finite gain,
and shifted pitch within that source's documented frequency range. No clamp,
reroll or silent skip. A failed variant fails the whole sound build.
The endpoint rule uses the worst-case onset/end relative to loop boundaries.
Zero-gain random draws can yield silence; such a selected variant fails the
existing silent-output gate instead of being silently replaced.

The sound ID, root seed, variant ID/seed, sequence ID, iteration, step ID and
voice ID determine each event's stochastic identity. Timing, pitch, gain,
duration, noise, breath, jitter, trill phase and excitation use independent
random streams. Changing one range does not consume another control's stream;
disabling breath or jitter does not perturb other controls. Event pitch variation
owns fixed detuning, while chirp jitter shapes drift within the note.

Reordering records and appending repetitions preserve existing event randomness.
Changing a variant ID or seed affects that variant only. Renaming a sequence,
step or voice intentionally changes its random identity. Adding events can change
the final mixed waveform even though existing events retain their own samples.
Use the same CLI sound-contract fingerprint and source to reproduce PCM16 bytes;
different OGG encoder versions are not guaranteed to produce identical bytes.

## 4. Modal resonator source

```text
source = {
  kind = "resonator";
  excitation = { kind = "impulse"; };
  modes = [
    { id = "body"; hz = 640; decay = 0.45; gain = 1; },
    { id = "edge"; hz = 1730; decay = 0.22; gain = 0.35; }
  ];
};
```

`modes`: 1..16 unique ID records, hz 40..16000, decay 0.01..10 seconds,
gain 0..1 with at least one positive gain. Decay is T60: seconds until a
free mode's amplitude falls to 0.001 of its starting envelope. All values
are constants. Per-event pitch variation moves hz; duration variation scales
the event/envelope but never rewrites this physical decay time.

Excitation is exactly `{ kind = "impulse"; }` or
`{ kind = "noise"; duration = 0.006; }`, with noise duration 0.002..0.05
seconds and no longer than the shortest event. Excitation is shared across
modes, not independently randomized per mode. No external audio excitation.
Impulse x[0]=1 and x[n>0]=0. A noise burst is seeded uniform [-1,1), multiplied
by sin(pi*n/(M-1))^2 and divided by sqrt(sum(window^2)); do not normalize each
random realization. M is quantized excitation duration, at least 96 frames.

For a mode: theta=2*pi*hz/48000, r=10^(-3/(decay*48000)). Use the impulse
response h[n]=r^n*sin((n+1)*theta), n>=0, implemented by the recurrence
`y[n]=2*r*cos(theta)*y[n-1]-r*r*y[n-2]+sin(theta)*x[n]`, initial state zero.
It fixes the gain convention without a hidden Q parameter or per-mode peak
normalizer. Sum modes in ID order with weights gain/sum(all mode gains); compute that
denominator in the same ID order. Equal or nearby mode frequencies are allowed
(no hidden merge or spacing constraint); beating is authored behavior.
The modal sum passes through voice highpass, lowpass, voice gain and event gain.
Mode frequencies and decays describe the sound; material realism still needs listening.

Frequency shift must keep every mode within 40..16000 Hz. Modal tails end at
event duration and obey the explicit gain envelope; never auto-extend the
root. The resonator is linear and has no nonlinear collision, feedback,
frequency modulation or animated mode parameters.

## 5. Loop region, bake and delivery

A loop source explicitly chooses the raw interval and overlap seconds:

```text
playback = { kind = "loop"; start = 0.4; end = 4.4; crossfade = 0.08; };
```

The raw sound is rendered including any warm-up before `start`. Samples after
`end` are not delivered. The interval is [S,E), where frame conversion below
applies, L=E-S and X=crossfade frames. Require 0<=S<E<=rawFrames,
X>=96, X<=min(48000,floor(L/4)) and delivered L-X>=2400 frames. Zero-crossfade
and metadata-only looping are rejected in this scope. Crossfade is fixed
smooth equal-gain (unity-sum), with no curve selection or equal-power default.
This avoids gain inflation for correlated head/tail material; uncorrelated
noise can have a dip; listen to repeated cycles to assess the result.

Bake exactly once before fixed output gain, where raw PCM is x:

- Output begins with x[S+X .. E-X), length L-2X.
- Append X samples: for k=0..X-1, u=k/(X-1), w=u*u*(3-2*u),
  append (1-w)*x[E-X+k] + w*x[S+k].
- Result has L-X frames, starts at raw S+X, and wraps from raw S+X-1 to
  raw S+X. No duplicated head, extra silent pad, sample averaging at the seam,
  post-bake fade-in/out, or padding back to the requested raw length.

Example: the 4-second raw interval above produces a 3.92-second loop (188160
frames), not 4 seconds. The authored `duration` remains raw render duration;
CLI reports both raw and delivered duration. The loop's playback origin shift
is explicit and deterministic. Intro/outro playback around a loop is out of
scope: use separate assets; do not silently preserve cropped audio.

Apply `output.gainDb` once to the delivered buffer, after any crossfade:
`sample *= 10^(gainDb/20)`. `rmsDb` is rejected. There is no automatic RMS
normalization, limiter, clipping or variant-dependent gain correction. Those
would erase an authored gain variation, especially for a single event. RMS
and DC are measurements only; warn-level loudness advice never mutates PCM.

Compilation fails if prequantized RMS is below 1e-8, a sample is nonfinite, or
peak exceeds `10^(peakDb/20)`. PCM16 rounding happens once; a decoded peak above
the ceiling or an all-zero result also fails. The diagnostic reports measured
peak and suggests a lower fixed gain. Review that suggestion and edit the source;
the compiler never retries with a different gain. Leave headroom for rounding.

Receipt peak, RMS and DC describe decoded PCM16. Seam delta and maximum adjacent
sample delta help inspect a loop boundary. First and last samples need not be
equal: they are consecutive samples across the wrap, not a duplicated sample.
Crossfade reduces discontinuity but cannot guarantee an inaudible edit for every
input. Choose levels and assess seams by listening as well as measurement.

Every sound variant receipt and game runtime entry carries playback intent:
`{ kind: 'oneshot' }` or `{ kind: 'loop', startFrame: 0, endFrame: frames }`.
These bounds describe baked output; raw crop and crossfade remain in source and
inspection. WAV is fmt+data PCM16 with no embedded loop instruction. When using
a standalone WAV, enable full-buffer looping in the consumer yourself.

| Delivery path | Behavior |
| --- | --- |
| CLI WAV export / build | Exact baked WAV; inspection and build receipt expose playback intent |
| Audio study / landing | Full-buffer loop playback; playback stops on navigation, selection, downloads and comparisons |
| `game_assets` WAV | Playback metadata includes validated frame bounds; configure runtime looping from the manifest |
| OGG export or game OGG pack | Loop assets are rejected because exact loop playback is not supported through this codec |
| Minecraft pack | Loop assets are rejected because sound-event delivery does not carry loop intent |
| One-shot OGG/Minecraft | Existing behavior retained with the new source contract |

## Resource limits

A source is at most 256 KiB, 12000 literal tokens and 16 nesting levels.
At most 1024 curve knots, 256 expanded events per variant, 32 simultaneous
events and 30 raw seconds are accepted. Across all variants, event work is
limited to 24 million frames and weighted DSP work to 192 million frames.
Variation bounds count toward limits even when the sampled event is shorter.

A workspace may contain up to 32 sound sources and 240 seconds of raw audio across all variants. Its combined event and weighted-work limits are the same as a single sound: 24,000,000 event frames and 192,000,000 weighted frames. All sources are checked before synthesis. FM uses 8× synthesis and a fixed 20 kHz lowpass before downsampling; its work weight is 128.

## Complete example

This pattern combines curves, repetition, bounded variation, resonance and a
baked loop. Save as `bell_pattern.ashfox`; it delivers 96960 frames (2.02 s).

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
npx --no-install ashfox build bell_pattern.ashfox --json
npx --no-install ashfox export bell_pattern.ashfox --variant base --output bell.wav
```

See [sound creation and listening](../guides/sounds.md) for review and delivery.
