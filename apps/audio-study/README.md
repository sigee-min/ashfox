# Sound viewer and local harness

Author sounds in native `.ashfox` files. The six examples live in
[`examples/sounds/src`](../../examples/sounds/src), with a root
[`.ashfoxworkspace`](../../examples/sounds/.ashfoxworkspace) for common asset builds.
See [the sound source guide](../../docs/guides/sounds.md) for syntax and bounds.

`@ashfox/audio-core` owns parsing, validation, synthesis, mastering and WAV
encoding. This harness uses its public API; it contains no second DSP engine.
No recordings, external samples or executable source expressions are accepted.

## Local viewer

```sh
npm --workspace @ashfox/audio-study run build
npm --workspace @ashfox/audio-study run dev
```

The server opens at `http://127.0.0.1:3134`. The English viewer offers sound
selection, playback, variations, comparison and downloads. It has no model
preview, source editor or review form.

Viewer builds use the built-in WebAssembly Vorbis encoder and decoder for OGG
output and round-trip validation; no external FFmpeg is needed. Native WAV
synthesis in the shared core also requires no browser.

The default scratch store is `.ashfox/audio-native`, ignored by Git. Override
it with `ASHFOX_AUDIO_STORE`. Initialization copies examples once; subsequent
builds read that store's current source head. Repository example edits do not
silently replace a working session. Legacy JSON stores are not migrated.

## Agent workflow

Use `npm --workspace @ashfox/audio-study run agent` with one JSON request on stdin, or `POST /api`.
`GET /capabilities` supplies exact request fields, syntax and native examples.

1. `inspect` the head and complete source inventory.
2. `propose` full native source writes/deletes against that head.
3. `build` the candidate and poll the HTTP job if applicable.
4. `present` the matching receipt; listen and compare through the viewer.
5. `apply` that candidate/build against its original head.
6. `export` the applied head/build as `audio-bundle`.

Build and presentation never change the head. Application uses a writer lock
and compares the original head before replacing it. Artifacts are verified
against receipt hashes. Failures and cancellation leave the head unchanged.
Exports preserve native source files and exact WAV/OGG bytes. There is no
review record or `adopt` compatibility alias.

The local scratch head is an experiment store; checked-in `.ashfox` sources
and their root workspace configuration define the asset project for builds.
Game-specific runtime integration consumes CLI build outputs.

## Verification

```sh
npm --workspace @ashfox/audio-study run test
npm --workspace @ashfox/audio-study run test:integration
```

The integration suite uses the real encoder and HTTP API, checks shared-core
WAV byte equality, source isolation, stale heads, failures and cancellation.
Technical checks do not establish naturalness or replace listening.
Limits: 48 kHz mono, 30 raw seconds per sound, 16 voices, 32 sequences and eight variants,
32 sounds and 240 total variant seconds. Stores hold at most 128 snapshots
and candidates, 64 builds and 64 exports; start a new store when full.

Loop outputs carry full-buffer playback metadata and offer WAV only. The viewer
honors that intent and stops playback on selection, comparison, navigation or
download. A synthesis worker uses the shared asset-build job runner; HTTP job
cancellation joins the child before reporting completion.
