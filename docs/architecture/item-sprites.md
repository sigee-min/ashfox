# Native sprite compiler

The [sprite guide](../guides/sprites.md) owns user-facing syntax and examples.
The [workspace guide](../guides/workspace.md) describes source selection and PNG
exports. The [item studio](../../scripts/items/README.md) is an optional viewer.

`engine-core/compiler/sprite` parses native declarations and lowers them into a
validated pixel plan. Modules expose masks, materials and stamps; ordered paint,
erase, stamp and part operations produce RGBA, PNG and pixel provenance.
`minecraft-item-v1` enforces 16×16 integer pixels and binary alpha. Shading and
grain are explicit source settings; no hidden image-generation step runs.

The raster compiler uses deterministic integer shading, fixed ramp interpolation
and seeded grain. Protected patches apply after shading. Source and output hashes
track lineage; preview backgrounds and enlargements never change exported pixels.

The JSON record in `tests/fixtures/items.json` is an internal lowering-parity
fixture. Native CLI input is `.ashfox` source, not that intermediate record.
Source parser, compiler and studio tests cover the contract. Changes to accepted
syntax require updating the guide and executable source examples together.
