# ashfox Engine Core

`@ashfox/engine-core` is the deterministic canonical-asset compiler used by
the Ashfox Workbench.

Its durable input is a closed `.ashfoxworkspace`: exact `ashfox-model 1`
source modules, package manifests, and a content-addressed lock. A selected
entry explicitly chooses nominal rigs, skeletons, reusable components,
surfaces, socket connections, and motions. The compiler resolves, checks,
instantiates, canonicalizes, and exports that entry without host I/O or hidden
design inference.

Key boundaries:

- `src/project/source/` owns neutral source spans, tokens, and diagnostics.
- `src/immutable.ts` owns canonical deep freezing shared by compiler, project
  opening, and export compatibility records.
- `src/project/program/syntax/` owns neutral v1 tokens and exact expressions.
- `src/project/program/asset/` owns package-aware declarations and parsing.
- `src/project/workspace/` owns logical paths, manifests, locks, hashes,
  selected-entry closure, and structural change staging.
- `src/compiler/program/asset/` owns nominal Typed HIR, exact instantiation,
  shared design evaluation, texture planning, and target-neutral canonical lowering.
- `src/model/measurement/` owns read-only rest-pose bounds and face UV evidence.
- `src/projectFile/workspace/` owns the canonical portable workspace codec.
- The semantic workspace change boundary compiles every declared entry before
  committing one workspace-hash CAS candidate.
- `src/provenance/digest.ts` owns neutral SHA-256 helpers.
- `src/validation/` independently validates canonical and target output.
- `src/export/` adapts a validated project for Bedrock, GeckoLib, GLB, glTF,
  Java block, or debug interchange.

The package is pure TypeScript domain code. It must not import React, browser
DOM APIs, Three.js, transport state, host globals, or persistence
implementations.
