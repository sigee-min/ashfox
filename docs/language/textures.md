# Model texture specification

A model surface has two declarations: a contract describing the atlas and charts,
and a concrete surface implementing that contract with material and pixels.
These textures are distinct from the standalone [sprite grammar](sprites.md).

## Contract and implementation

| Scope | Declaration | Requirement |
| --- | --- | --- |
| `surface contract Skin` | `atlas { width = …; height = …; }` | Explicit texel dimensions |
| Contract | `chart name box { width = …; height = …; coverage = …; }` | UV net for a cube; use `flat` for a plane |
| Contract | `material = opaque;` | `opaque`, `cutout` or `double` |
| Contract | `slot name: type;` | Optional named value requirement with a closed type |
| `surface red: Skin` | `material = opaque;` | Must implement the contract's material |
| Surface | `slot name = expression;` | Supply declared slots with compatible values |
| Surface | `texture atlas { … }` | One explicit texture recipe |

Use a concrete [complete model surface](model.md#complete-source) as a starting
point. Widths, heights and origins can consume [design values](values.md).
A contract's chart names, dimensions, coverage and material are checked when the
surface is bound; matching spelling alone does not make distinct contracts equal.

## Texture recipe fields

| Statement | Meaning |
| --- | --- |
| `atlas = (16px, 8px);` | Texture dimensions, agreeing with the contract |
| `background = shade;` | Palette role used outside charts |
| `background-alpha = 255;` | Integer alpha in `[0,255]` |
| `palette { shade = #21100c; coat = (#7d2417, #c94f2a, #ef8141); }` | Flat colors or three-color ramps |
| `chart body box { origin = (0px, 0px); fill = coat; }` | Explicit atlas placement and palette role |
| `grain clustered { seed = 23; }` | Exactly one deterministic grain declaration |
| `tone voxel;` | Optional voxel shading mode |
| `stamp eye { pixels = "ee/e."; e = shade; }` | Reusable pixel symbol |

Geometry references the required surface port and chart with
`surface = skin.body;`. A cube or plane requires exactly one such binding.
The chart's UV footprint must fit its atlas and match its geometry. For a box
with dimensions `(w, h, d)` at one texel per model unit, its net dimensions are
`(2*w + 2*d, h + d)`. Do not guess atlas positions or resize a chart independently
of its cube. Ashfox does not automatically pack charts.

`opaque` coverage requires opaque pixels; `binary` permits transparent/opaque
coverage; `optional` relaxes required coverage. Choose material and coverage
together. `cutout` and `double` are explicit material choices, not aliases for
arbitrary fractional-alpha blending.

## Faces, patterns and coverage

Box chart faces use `north`, `south`, `east`, `west`, `up`, `down`.
Face-local stamp coordinates start at that face's top-left, rather than the
atlas origin. Moving a chart within an atlas preserves face-local coordinates.

A chart or face may contain `pattern blotch` with `paint`, `scale`, `density`
and `phase` settings. All four are required:

| Pattern property | Type and range |
| --- | --- |
| `paint` | Palette role |
| `scale` | Three integral texel scalars, each 1–128, such as `(2px, 2px, 2px)` |
| `density` | `ratio` from 0 through 1 |
| `phase` | Integer 0–4294967295 |

Patterns must precede stamp placement. They control palette pixels, not geometry.
Use [existing creature surfaces](../../examples/shared-creatures/creatures/surface.ashfox) for full
recipes with their corresponding contracts.

The recipe `coverage = …;` form belongs to a flat chart, never a face or box
chart. Its unquoted binary digits run row by row and must contain exactly
`width * height` bits. Binary contract coverage requires this mask; opaque
coverage cannot contain zero bits. It is a pixel mask, distinct from the
contract's `opaque|binary|optional` enum.

## Stamps

Define a stamp once inside the texture recipe. Place it inside a face for a
box chart, or directly inside a flat chart. A stamp's `pixels` is a quoted string of equal-width rows separated by `/`.
`.` is transparent; lowercase letters or digits name palette mappings. Every
used symbol needs exactly one mapping, and unused mappings are rejected.

Fragment inside the same texture recipe:

```text
stamp eye { pixels = "eee/egg/eee"; e = outline; g = iris; }
chart head box {
  origin = (0px, 0px);
  fill = coat;
  face west { stamp eye { anchor = top_left; offset = (1px, 2px); } }
  face east { stamp eye { anchor = top_right; offset = (-1px, 2px); flip = x; } }
}
```

| Placement property | Allowed value / semantics |
| --- | --- |
| `at` | Explicit `vec2<texel>` placement; use instead of anchor/offset |
| `anchor` | `top_left`, `top`, `top_right`, `left`, `center`, `right`, `bottom_left`, `bottom`, `bottom_right` |
| `offset` | Required with an anchor; signed texel offset, right/down positive |
| `flip` | `none` (default), `x`, `y`, `xy`; reflects contents within the stamp rectangle |
| `protect` | Optional nonnegative integral texel margin; keeps later tone/grain from changing the protected region |

Placement never scales the stamp. The complete stamp and protection rectangle
must fit the face. Center placement that falls on half a texel fails rather than
rounding. A flip changes contents, not placement. Later explicit stamps can still
overpaint protected pixels. See [pixel anchors](../guides/precision-modeling.md#fixed-size-marks-and-protected-detail)
for resizing and opposite-face examples.
