# Blockbench Spec Snapshot & Test Engine

This repo keeps a **Blockbench spec snapshot** to drive the simulation-based test engine
without requiring a live Blockbench session. The snapshot is intentionally scoped to the
behaviors we need for texture/UV correctness, not a full reproduction of Blockbench.

## What the snapshot covers
- **Blockbench version & release tag** (for tracking changes that might affect formats/UV).
- **bbmodel breaking changes** relevant to texture/UV handling.
- **Format capabilities** (e.g., `per_texture_uv_size`) used by the simulator.
- **Sources** that must be re-checked on updates.

The snapshot lives at:
- `docs/blockbench-spec-snapshot.json`

## Why it exists
Blockbench's own docs explicitly note that the `.bbmodel` format is not fully specified.
The simulator therefore needs a stable, versioned snapshot to:
- reproduce UV scaling behavior in tests
- keep assumptions explicit and reviewable
- make updates easy to audit

## Update workflow
1) Run the updater script:
   - `npm run spec:sync`
2) Review the diff in `docs/blockbench-spec-snapshot.json`.
3) If format flags change, update:
   - `src/adapters/sim/BlockbenchSpec.ts`
   - any affected fixtures in `scripts/tests/fixtures/`
4) Run tests and quality checks:
   - `npm test`
   - `npm run quality:check`

## Simulation scope
The simulator uses the snapshot to decide:
- default texture resolution
- per-format UV sizing (`per_texture_uv_size`)
- single vs multi-texture constraints (when known)

When running **inside Blockbench**, the real Format API is still the source of truth.
The simulator only aims to approximate it well enough for reliable tests.
