# Sound DSL: automation, sequencing, variation, resonance and loops

Status: implemented and independently reviewed, 2026-09-13. This document
records the coordinated hard cut and its acceptance criteria. See the
[implementation review](sound-review.md) for measured evidence and
[the sound syntax reference](../language/sounds.md) for asset authoring.
Public release acceptance is tracked separately from implementation approval.

## Outcome and scope

An author defines a reusable voice, schedules finite instances of it, describes
how its parameters evolve, and exports reproducible one-shot or loop audio.
One native `.ashfox` file remains the only authoring authority. No recordings,
URLs, executable expressions, plugins, general functions, imports, runtime DSP
graphs, tempo notation, stereo, reverb or automatic material presets enter this
change. Resonance is a new procedural source, not a sample player or effect bus.

Decisions:

1. Replace special-purpose pitch sweeps and chirp contours with one scalar-or-
   curve contract; apply it to a defined set of musical controls.
2. Replace `layers` with reusable `voices` and finite `sequences`. A single
   event is a one-step, one-iteration sequence; no second scheduling syntax.
3. Variation uses explicit bounded ranges per event property, sampled once per
   instance from independent deterministic streams. It is not per-frame noise.
4. Add a bounded modal `resonator` with explicit excitation and decay times.
5. Bake loop crossfades into PCM, emit the actual resulting length and playback
   intent, and require delivery adapters to preserve or reject that intent.

The source header stays `ashfox-model 1`; there is no `sound v2` declaration,
legacy mode, automatic upgrade reader or parallel old renderer. Release SemVer
is still managed by release-please. A hard cut does not mean reusing stale
compiler fingerprints or distributing incompatible packages under one version.

## Previous implementation and ownership

`packages/audio-core/src/source.ts` parses bounded literal records and
`read.ts` validates the closed `SoundRecipe`. `render.ts` mixes ID-sorted layers;
`variant.ts` derives variant seeds. `index.ts` renders and masters each variant,
and `wav.ts` emits mono PCM16 at 48 kHz. Previous limits were 5 seconds, 8 layers,
8 variants. Curves previously existed only as chirp pitch contours; FM/vocal have
separate two-point pitch/sweep records. The previous renderer faded every layer.

`SoundProduct`, bundle receipts and game manifests previously had no loop
contract. Some consumers assume a 44-byte WAV header. This design keeps that
WAV format; it does not add an unrecognized `smpl` chunk. Loop intent travels
in the product/receipt/runtime manifest, not in invented RIFF metadata.

| Owner | New responsibility |
| --- | --- |
| `audio-core` | Native parser spans, closed recipe, curve evaluation, bounded event expansion, random keys, synthesis, loop bake, fixed output gain, playback metadata |
| `engine-core` | Native dispatch, compiler identity and current sound product propagation |
| `asset-build/bundle` | Receipt shape, output hashes and actual frame counts |
| `asset-build/packs/game` | Closed runtime playback contract and reader validation |
| `asset-build/node` | Codec restrictions, decoded-output verification, atomic publication |
| `apps/cli` | Capabilities, diagnostics, export, cancellation and inspection |
| `apps/audio-study`, `apps/site` | Read-only playback intent and loop evidence; no second renderer |
| `scripts/release`, public docs and skill | One verified installable contract |

Keep immutable public records at the audio-core barrel. Private `curve.ts`,
`schedule.ts`, `random.ts`, `resonator.ts`, `loop.ts` and `plan.ts` own their
respective decisions; mutable oscillator/filter state stays private. The
expanded frame plan is transient derived data and never another source format.

## Closed source contract

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

```ashfox
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
the table and `kind`. Delete `sweepSeconds`, two-element `pitch`, and `contour`.
FM/vocal/chirp source implementations consume the same evaluated pitch control.

Filtering remains highpass then lowpass with the existing one-pole recurrences;
recalculate their stable coefficients at each sample from evaluated cutoff Hz.
Validate max(highpass) < min(lowpass) over the full curves. This conservative
rule deliberately rejects overlapping cutoff ranges even if their pointwise
trajectories never cross; it avoids accepting a relation only some instances
satisfy. The diagnostic explains how to separate the ranges.

Delete layer `attack`/`release`. Authors express attack, sustain and release as
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

```ashfox
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

Retain root/variant seed ownership, but replace the current seed derivation and
shared mutable per-layer RNG with independent domain keys. Hash UTF-8 JSON arrays using the existing
32-bit FNV-1a plus avalanche seed mixer, zero repair to 1. Key contents are:
`[audioPolicy, soundId, rootSeed, variantId, variantSeed, sequenceId,
iteration, stepId, voiceId, domain]`. JSON arrays remove delimiter ambiguity.
Domain is one of `timing`, `pitch`, `gain`, `duration`, `noise`, `breath`,
`jitter`, `trill-phase`, `excitation`. Per-source time-varying randomness has
its own xorshift32 state, U=uint32/2^32. Resonator excitation is one shared stream per instance; modes consume no
random values. Chirp jitter uses its jitter stream only for within-note drift;
remove its old implicit fixed detune, since event pitch variation now owns that
decision. Disabled breath/jitter/trill controls do not advance other streams.

The new key derivation is the only seed authority: remove the public
`soundVariantSeed` helper and its old call sites in the coordinated cutover.
Do not hash a prederived variant seed as an additional hidden step. The initial
policy literal is `sound:curves-sequences-variation-resonator-loop:fixed-gain:pcm16`.
For UTF-8 key bytes b: h starts at 2166136261 and each byte applies
`h = imul(h XOR b,16777619) >>> 0`. Then apply, in order:
`h ^= h >>> 16; h = imul(h,0x85ebca6b) >>> 0; h ^= h >>> 13;`
and use `(h >>> 0) || 1`. Each draw performs
`h ^= h << 13; h ^= h >>> 17; h ^= h << 5`, then returns `(h >>> 0)/2^32`.
All bit operations are the specified 32-bit operations; JSON keys contain
only ASCII IDs, integer numbers and that policy string, with no whitespace.

Golden vectors for the full key above using bell_pattern/7349/base/42/phrase/
0/strike/bell, differing only in the domain:

| Domain | Initial uint32 state | First drawn uint32 |
| --- | --- | --- |
| timing | 526853703 | 2388183440 |
| pitch | 1740750544 | 1399410045 |
| excitation | 1326868862 | 3305432098 |

Changing one variation range never consumes another parameter's stream.
Changing variant IDs/seeds changes that variant only. Adding events does not
change the unmixed PCM of unchanged events; final mixed bytes can change. Hash collisions are possible in 32 bits; do not claim mathematical
uniqueness. Exact PCM byte stability is required across supported Node 24
release platforms using a shared golden corpus; other JS engines and different
OGG encoders are not promised byte equality. If platform math differs at PCM16
quantization, standardize the numerical kernel before shipping, not the tests.

## 4. Modal resonator source

```ashfox
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
Then apply voice highpass, lowpass, voice gain and event gain. No generic
material names pretending to guarantee wood/glass/metal realism.

Frequency shift must keep every mode within 40..16000 Hz. Modal tails end at
event duration and obey the explicit gain envelope; never auto-extend the
root. This initial resonator is linear, with no nonlinear collision, feedback,
frequency modulation or dynamic pole interpolation. Golden impulse responses,
T60 estimates and listening comparisons establish behavior before release.

## 5. Loop region, bake and delivery

A loop source explicitly chooses the raw interval and overlap seconds:

```ashfox
playback = { kind = "loop"; start = 0.4; end = 4.4; crossfade = 0.08; };
```

The raw sound is rendered including any warm-up before `start`. Samples after
`end` are not delivered. The interval is [S,E), where frame conversion below
applies, L=E-S and X=crossfade frames. Require 0<=S<E<=rawFrames,
X>=96, X<=min(48000,floor(L/4)) and delivered L-X>=2400 frames. Zero-crossfade
and metadata-only looping are rejected in this scope. Crossfade is fixed
smooth equal-gain (unity-sum), with no curve selection or equal-power default.
This avoids gain inflation for correlated head/tail material; uncorrelated
noise can have a dip, which the listening gate must assess.

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
`sample *= 10^(gainDb/20)`. Replace `rmsDb` entirely. There is no automatic RMS
normalization, limiter, clipping or variant-dependent gain correction. Those
would erase an authored gain variation, especially for a single event. RMS
and DC are measurements only; warn-level loudness advice never mutates PCM.

Fail if prequantized RMS <1e-8, any sample is nonfinite, or prequantized peak
exceeds 10^(peakDb/20). Quantize once using the existing PCM16 rounding rule,
then also reject decoded peak above the ceiling or all-zero PCM. The diagnostic
reports measured peak and a suggested lower fixed gain; do not retry with it.
A rounding overshoot at the ceiling still fails; authors leave headroom.
Calculate receipt peak/RMS/DC from decoded PCM16. Record seam delta and
adjacent-sample slope evidence. Do not force first sample==last sample: the
seam must behave like neighboring samples, not duplicate a sample. Crossfade
reduces discontinuity but cannot guarantee a perceptually invisible edit for
arbitrary input. The user chooses levels before release by listening, rather
than the compiler normalizing away those decisions.

`SoundProduct.playback` and every sound variant receipt/runtime entry gain a
required discriminated record: `{ kind: 'oneshot' }` or
`{ kind: 'loop', startFrame: 0, endFrame: frames }`. This metadata describes
baked output; raw selection/crossfade belongs only to source and inspection.
The WAV remains exactly fmt+data PCM16 mono. Consumers ignoring metadata can
play the buffer once; authors must set full-buffer loop playback themselves
when using a standalone WAV. CLI help and public docs must say so explicitly.

| Delivery path | Required behavior |
| --- | --- |
| CLI WAV export / build | Exact baked WAV; inspection and build receipt expose playback intent |
| Audio study / landing | Honor loop intent via full-buffer loop playback; stop on navigation/selection; explicitly stop before downloads or comparisons as appropriate |
| `game_assets` WAV | Emit and validate playback metadata, integer bounds and file frame counts; sample consumer configures runtime loop from the manifest |
| OGG export or game OGG pack | Reject loop assets with a targeted codec diagnostic in this release; no unverified sample-accurate promise through lossy encoding |
| Minecraft pack | Reject loop assets: current sound-event delivery has no matching loop intent contract |
| One-shot OGG/Minecraft | Existing behavior retained with the new source contract |

Do not add RIFF chunks merely to carry metadata; if future work does, replace
all fixed-header consumers together. Future codec support requires decoded
frame bounds and real target looping evidence, not file-extension substitution.

## Frame plan and resource limits

One frame conversion for nonnegative seconds: Q(t)=floor(t*48000+0.5).
Quantize onset and instance duration separately: [Q(onset), Q(onset)+Q(duration)).
Never independently round an authored end then truncate an event. Check both
continuous support and quantized support before allocation. Loop start/end
use Q individually; crossfade uses Q. Render zero-initialized Float64 buffers,
continuous oscillator phase inside each instance, and canonical summation.
FM now synthesizes at 8× the output rate, then uses a normalized 257-tap
Blackman-windowed sinc filter at 20 kHz before decimation. Its 128-microframe
linear-phase delay is compensated with bounded 16-output-frame lookahead;
source boundaries are zero-padded. Its work weight is 128, adjusted after
review exposed aliasing at the previously accepted high-frequency settings.
Other sources retain their measured synthesis policy; fundamental range
validation alone is not an alias-free guarantee.

Initial release ceilings below are deliberate acceptance requirements. If the
performance corpus exceeds them, adjust the design and documented limits
before release rather than inserting a machine-dependent timeout into DSP.

| Limit | Maximum |
| --- | --- |
| Source bytes / literal tokens / nesting | 256 KiB / 12000 / 16 (retain current parser budgets) |
| Total curve knots across voices | 1024 |
| Expanded instances per variant | 256, counted before expansion/allocation |
| Simultaneously active instances | 32 across full variation support |
| Sum of event frames across all variants | 24,000,000 |
| Weighted DSP frames across all variants | 192,000,000 |
| Output frames per variant | 1,440,000 raw (30 seconds) |

Weighted work = sum(eventFrames * sourceWeight), with noise=1, FM=128,
chirp=8, vocal=16, resonator=4+4*modeCount. Add eventFrames times the number
of animated controls to that cost. The weights are conservative scheduling
units, not claimed CPU instruction counts. Worst-case durations and overlap
bounds include every variation support, not sampled realizations. Modes,
knots and repeated instances are charged even if a gain is zero.

Directory workspaces preflight all sound declarations before rendering, with
32 sound sources, 11,520,000 total raw variant frames (240 seconds), 24,000,000
event frames and 192,000,000 weighted frames across the entire workspace.
The same exported soundBudget analysis supplies these counters, not a second
set of estimates. The former 60-second workspace cap is removed.

Render variants serially and events into the shared mix without retaining
per-event PCM buffers. Keep result byte accumulation within a 256 MiB job
budget, including scratch/encodings, and test process RSS at the upper-bound
corpus. Thread count and parallel variant rendering must not change summation.

The audio core remains synchronous, pure and host-independent. A same-thread
AbortSignal cannot interrupt this CPU loop, so public Node build/observation
and audio-study jobs execute compilation in a worker owned by the shared
`asset-build/node` job adapter. The parent receives cancellation, terminates
and joins the worker, and discards its candidate before reporting cancellation.
Parent owns source snapshot identity, stale-head checks and atomic publication;
the worker receives the sealed in-memory source/configuration, has no authority
to publish, and transfers results only on whole-job success. This covers the
existing synchronous directory dispatch without pretending a microtask yield
lets a timer interrupt it. Workers are joined on success, failure and shutdown.

The core checks budgets and finite state in bounded batches (at most 4096
sample frames per event, mode count already bounded). Direct synchronous API
calls are explicitly noncancellable; CLI and HTTP endpoints may not use that
shortcut on the main thread. Cancellation latency is a measured adapter gate
(maximum 250 ms after abort delivery on supported release runners), independent
of the next variant boundary. Cancellation, budget failure, non-finite sample,
stale source or invalid later variant returns no partial published bundle and
preserves existing outputs. Account worker RSS separately from the parent and
verify combined incremental RSS <=256 MiB for the worst-case corpus.

## Complete example using all five features

Complete current syntax; use a CLI carrying the sound contract fingerprint above:

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

The example demonstrates contract composition, not an approved sound preset.
Its output is 96960 frames (2.02 seconds). A bird phrase reuses a chirp voice
and multiple named steps; footsteps use a short noise/resonator voice; wind
uses one long noise instance and an interior crop after filter warm-up.

## Diagnostics and implementation acceptance

Parser must retain canonical property-path-to-token spans. Current semantic
errors point at the end of the sound block; that is insufficient for nested
curves and sequence expansion. Every error carries code, owning source path,
line/column, declared limit and actual offending value. Expanded failures also
include sequence/step ID and iteration. Diagnostics are stable in canonical
ID order. Do not serialize transient renderer internals as user source.

| Gate | Evidence required |
| --- | --- |
| Closed reader | Unknown/old fields, invalid references/IDs, nonfinite numbers, all limits, duplicate and collapsed knots fail at their source token |
| Curves | Endpoints, midpoint, smooth slope, log positivity, no overshoot, filter range invariant, shortest-duration resolution, endpoint envelopes |
| Scheduling | Single/repeated/multistep, overlaps, half-frame rounding, exact end, support crossing start/end, ID order invariance and budget exhaustion |
| Randomness | Golden domain vectors, repeat append stability, reorder stability, range isolation, extreme support validity, all variant outcomes atomic; gain differences survive fixed output gain |
| Resonance | Analytic impulse recurrence, modal frequencies/T60, excitation RMS policy, no unstable/nonfinite poles, decay truncation and extreme pitch |
| Loops | Exact bake vector for a tiny fixture, 188160-frame example, crop/origin shift, endpoint adjacency, correlated-tone and noise gain behavior |
| Output | Fixed gain, silent and quantized-silent variants, pre/post PCM16 ceiling, no automatic loudness correction |
| Delivery | WAV header/frame count, receipt/runtime metadata tampering rejected, OGG/Minecraft loop rejection preserves existing outputs, read-only players honor stop/loop |
| Lifecycle | Success/cancel/stale/exception/invalid-later-variant; no partial stdout artifact or mixed old/new bundle |
| Quality | Listen to bird phrase, footsteps, charging spell, metal/wood/glass studies, wind/fire/mechanical loops for at least 20 cycles; compare loudness-matched outputs and inspect seam spectrograms |
| Reproducibility | Same source/seed/canonical policy yields exact PCM16 across Linux/macOS/Windows on supported Node; elapsed time/RSS recorded at limits |

Listening is a human review gate, not a test asserting an animal/material name.
Record actual audition evidence; do not claim quality from waveform statistics.

## Hard-cut implementation and release order

1. Land contract/plan/DSP work on an integration branch with parser, property
   spans, new tests and migrated fixtures together. Do not publish partial
   support or add fallback readers to keep old examples green.
2. Convert every sound native example and harness input: each old layer becomes
   a voice and a one-step sequence; envelope curves replace attack/release;
   FM/vocal sweeps become pitch curves; chirp contour becomes pitch curve.
   Replace `output.rmsDb` with a measured, explicitly reviewed fixed `gainDb`.
   Reusable phrases can then be factored deliberately. Old bytes are not a
   compatibility guarantee: capture/listen to the new baseline explicitly.
3. Change `AUDIO_POLICY` and compiler/cache identities for the new renderer.
   Remove the internal recipe `format`/`version` fields: it is a compiler-owned
   current-contract record, not a second persisted authoring format. Keep the
   native declaration as authority; do not expose a selectable renderer revision.
   Existing externally persisted receipts/runtime schemas must reject old
   sound shapes and stale fingerprints; review all readers in the same slice.
4. Update CLI capabilities/inspect/help, game adapter, audio study, all current
   native examples, EN/KO guides/reference/revision acknowledgements, agent
   skill, landing media and technical receipts. Keep this proposal outside
   `docs/public.json`; replace user docs only when the executable is ready.
5. Run focused gates, then `npm run quality`, audio integration, capture and
   browser tests. Package and test the actual archive on all three OSes.
6. Publish a NEW SemVer release through release-please. Never replace immutable
   v1.0.0 assets. Download its public CLI archive into a clean project and compile
   the five-feature example plus each focused example; assert expected frame
   counts/metadata and explicit rejection of old sound grammar.
7. Point stable installation docs, agent install instructions and site download
   aliases at those SAME verified release bytes. Compare SHA256, CLI version
   and an exposed sound-contract fingerprint across all install paths. Then
   publish docs/media. A green repository CI or an updated landing WAV alone
   does not count as distribution of the DSL.

Internal work can be split by ownership, but the public cutover is one complete
change set. Implementation is not accepted until all five features, their
negative cases, and the official installation route agree.

## Design references and independent review

The curve domain and explicit frame-based loop decisions were cross-checked
against the [W3C Web Audio specification](https://www.w3.org/TR/webaudio-1.0/).
Ashfox uses offline baked PCM and the formulas above; it does not delegate
semantics to browser AudioParam scheduling or promise browser codec equality.
The resonator is specified by its recurrence here, not by a third-party preset.

Independent review completed on 2026-09-13 with the `sound_reviewer` agent.
The reviewer inspected the current parser, renderer, WAV, bundle/game delivery
and this proposal independently, then rechecked the changes. No renderer code
or public grammar was changed during this design review.

| Review finding | Final decision |
| --- | --- |
| RMS mastering would erase gain variation | Hard cut to fixed gainDb; explicit pre/post-quantization peak failure |
| Implicit frame rounding/truncation makes repeated and loop output ambiguous | One Q function, checked half-open event ranges, exact L-X bake formula |
| RNG helper plus new domain keys risks two seed authorities | Replace old helper with one JSON-key mixer; exact constants and golden vectors |
| Per-mode normalization can depend on list order | ID-sort numerator accumulation and denominator; shared excitation stream |
| Same-thread abort cannot interrupt synchronous synthesis | Node worker termination/join; parent owns cancellation and atomic publication |
| WAV loop chunks would break fixed-header consumers | Keep fmt+data WAV, carry intent in closed product/receipt/runtime metadata |
| OGG/Minecraft cannot honestly preserve this loop contract yet | Targeted failure for loop assets; one-shots remain supported |
| Site artifact and official CLI release currently diverge | New immutable release plus published-archive fixtures and SHA equality before docs promotion |

The reviewer approved this design with no remaining blocking findings and
independently reproduced all three RNG vectors. The implementation has completed independent review. Audio quality, performance
ceilings, cross-platform PCM equality and release delivery are acceptance gates
still to be demonstrated by implementation, not claims proven by this review.
