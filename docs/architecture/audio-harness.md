# Code-authored audio harness

Native `.ashfox` sources are the only sound authoring format. The checked-in
example project is `examples/sounds/.ashfoxworkspace`: a directory workspace
configuration with source files under `src/` and explicit WAV exports.
The source header remains `ashfox-model 1`; directory configuration uses its
own version 2 contract, shared with item and model projects.

## Ownership

- `packages/audio-core`: closed native parser, validated sound recipe, bounded
  synthesis, deterministic variant streams, mastering and PCM16 WAV encoding.
- `packages/engine-core`: directory workspace entry dispatch and export validation.
- `packages/asset-build` and `apps/cli`: shared project build and publication.
- `apps/audio-study`: local candidate storage, host-side OGG encoding, HTTP jobs
  and a read-only sound viewer. `engine.js` imports the public audio-core barrel.

There is no separate JavaScript DSP or JSON sound language in the harness.
Recordings, file/URL sound inputs, extracted sample models and arbitrary code
execution are unsupported. Generated WAV/OGG files are outputs only.

## Local experiment lifecycle

`inspect → propose → build → present → apply → export` uses immutable
snapshots and receipts. Application compares the candidate's original head
under a writer lock. Build, presentation, failure and cancellation do not
change the applied source. Export verifies artifact hashes and copies native
sources. The scratch store is `.ashfox/audio-native`; legacy JSON stores are
not read or migrated. It is not the source authority for repository builds.

The English viewer only selects, plays, compares and downloads results.
There are no model previews, motion bindings, review records or approval gates.
The API remains available for agents to change sources and apply results.

## Guarantees and limits

The shared compiler owns variant seed derivation. Sound seed, variant identity
and variant seed enter a separated hash stream, avoiding XOR seed collisions.
Layer identity stabilizes noise against array reordering. Pure tonal synthesis
can produce identical seed variants because it consumes no random samples.

The harness emits the shared core's exact WAV bytes. Its additional FFmpeg
adapter encodes OGG and checks decoded duration and headroom. Byte equality
across different JavaScript engines or OGG encoders is not promised.

Focused tests cover native parsing, deterministic output, noise variants,
source edits, source isolation, closed inputs, stale heads, hash corruption,
HTTP builds, encoder failure, cancellation and exact public-core WAV equality.
These checks do not prove animal realism. Interactive authoring, dynamic
sound graphs, animation cues and game runtime packaging are outside this change.

Setup and source syntax are in `apps/audio-study/README.md` and `docs/guides/sounds.md`.
