# Sound DSL implementation review

Implementation reviewed on 2026-09-13 against [the coordinated design](sound-dsl.md).
This records observed evidence; release validation is completed separately.

## Independent review

The `sound_review` reviewer independently checked parser/reader boundaries,
all variation supports, frame conversion, deterministic ordering, RNG vectors,
modal impulse responses, loop bake, delivery contracts and cancellation. The
reviewer approved the implemented core with no remaining blocking findings.

Problems found during review and corrected:

- Eight long noise variants increased RSS by 293.4 MiB. Replacing boxed sample
  allocation lowered the independently measured increase to 104.2 MiB.
- High-frequency FM modulation produced substantial aliasing. Eight-times
  oversampling and a 257-tap Blackman-windowed lowpass improved the tested
  passband residual to -100.63 dB against an independent high-rate reference.
  This is evidence for that test case, not an alias-free claim for all audio.
- The old 60-second directory cap rejected a valid long multivariant source.
  All declarations now preflight shared analysis before any synthesis.
- Worker termination could race with external encoder startup. A parent ACK
  now precedes subprocess spawn; cancellation kills and joins the encoder.
  Independent observed cancellation/join was 3.7–4.7 ms with no live child left.
- Runtime WAV metadata now validates actual header/frame counts, playback bounds
  and decoded statistics; unsupported loop codecs fail before locating FFmpeg.

Core checks include 16 independent adversarial cases, all three RNG vectors,
48,000-sample analytic modal responses at frequency/decay extremes, exact tiny
loop vectors and reordered-source PCM equality. Persistent tests live beside
core owners and in `apps/cli/tests/integration/sound.test.ts`.

## Performance evidence

Measurements below are local Node 24.13.1 on macOS. Permanent isolated-process
corpora enforce the memory/runtime ceiling; CI must additionally run them on
supported release operating systems. RSS increments exclude the initial host
baseline, and exact timings vary between runs.

| Accepted workload | Approximate elapsed time | Additional RSS |
| --- | --- | --- |
| 189,312,000 weighted modal frames | 0.24 seconds | 64–79 MiB |
| Eight 30-second noise variants | 0.66 seconds | 104–125 MiB |
| 30-second maximum-control FM source | 1.37 seconds | 30–34 MiB |

The installed CLI sound corpus in `scripts/release/sound-golden.json` covers
all five features, exact output bytes, loop intent and old syntax rejection.
Both ordinary three-OS CI and release-archive smoke tests run that corpus.

## Listening evidence

The user listened to `bird_call-base`, `metal_strike-base` and `wind_loop-base`
and explicitly accepted those outputs on 2026-09-13. That approval covers those
three supplied previews. It does not assert that all other studies/variants or
20-cycle playback were auditioned. Those remain examples with technical
validation, not recordings or certified material/animal realism.

## Delivery acceptance

A successful repository build is not a released compiler. The release gate
installs the packaged CLI on Linux, macOS and Windows and reproduces the sound
corpus before publication. Stable guides and the site's CLI download redirect
must resolve to the same new immutable GitHub release archive. The final task
report records the actual release version and public archive verification.
