# Asset build

The public entry is `src/index.ts`. The CLI and repository integrations use this
entry rather than importing individual implementation files.

| Owner | Responsibility |
| --- | --- |
| `src/bundle/` | Snapshot and artifact contracts, validation and bundle assembly. |
| `src/packs/` | Target dispatch and common archives. |
| `src/packs/game/` | Engine-neutral delivery and its closed runtime manifest reader. |
| `src/packs/minecraft/` | Java resource-pack delivery. |
| `src/shared/` | Deterministic digest, JSON and safe relative path helpers. |
| `src/node/` | Source snapshots, executable configuration, encoding, locks and publication. |

Bundle, pack and shared code cannot import Node adapters. Encoding is injected
through the `PackEncoder` contract. The old flat implementation paths have been
removed; no re-export shims remain.

Run `npm run test:cli`, `npm run test:packs` and `npm run quality:architecture`
from the repository root. The CLI integration suite covers deterministic bundles,
invalid inputs, interrupted publication, corruption and installation.
