# Model texture specification

A model surface has two declarations: a contract describing the charts (and
optional fixed atlas dimensions), and a concrete surface implementing that
contract with material and pixels. These textures are distinct from the
standalone [sprite grammar](sprites.md).

## Contract and implementation

| Scope | Declaration | Requirement |
| --- | --- | --- |
| `surface contract Skin` | `atlas { width = …; height = …; }` | Optional; omit to auto-pack to a power-of-2 atlas |
| Contract | `chart name box { coverage = …; }` | Optional `width`/`height`; omitted sizes are inferred from bound geometry |
| Contract | `material = opaque;` | `opaque`, `cutout` or `double` |
| Contract | `slot name: type;` | Optional named value requirement with a closed type |
| `surface red: Skin` | `material = opaque;` | Must implement the contract's material |
| Surface | `slot name = expression;` | Supply declared slots with compatible values |
| Surface | `texture atlas { … }` | One explicit texture recipe |

Use a concrete [complete model surface](model.md#complete-source) as a starting
point. Widths, heights and origins can consume [design values](values.md).
A contract's chart names, coverage and material are checked when the surface is
bound; matching spelling alone does not make distinct contracts equal.

## Texture recipe fields

| Statement | Meaning |
| --- | --- |
| `atlas = (16px, 8px);` | Optional texture dimensions; omit for deterministic auto-packing |
| `background = shade;` | Palette role used outside charts |
| `background-alpha = 255;` | Integer alpha in `[0,255]` |
| `palette { shade = #21100c; coat = (#7d2417, #c94f2a, #ef8141); }` | Flat colors or three-color ramps |
| `chart body box { fill = coat; }` | Chart recipe; omit `origin` to auto-pack (all charts in a texture must agree), optionally set `grain = clustered\|soft\|none;` |
| `grain clustered\|soft\|none { seed = 23; }` | Optional texture-level default grain (`seed` optional; defaults to `none` when omitted) |
| `tone voxel\|painterly;` | Optional shading mode (`voxel` directional flat tones or `painterly` form-following gradient + bevel rim) |
| `stamp eye { pixels = "ee/e."; e = shade; }` | Reusable pixel symbol |

Geometry references the required surface port and chart with
`surface = skin.body;`. A cube or plane requires exactly one such binding.
When chart dimensions are explicit on the contract, a box with `(w, h, d)` must
match `(2*w + 2*d, h + d)`. When dimensions and origins are omitted, the compiler
infers exact chart nets from geometry and packs them deterministically.

`opaque` coverage requires opaque pixels; `binary` permits transparent/opaque
coverage; `optional` relaxes required coverage. Choose material and coverage
together. `cutout` and `double` are explicit material choices, not aliases for
arbitrary fractional-alpha blending.

## Faces, patterns and coverage

Box chart faces use `north`, `south`, `east`, `west`, `up`, `down`.
Inside a `face <dir> { ... }` scope you can override `fill = <role>;`, mirror
another face horizontally via `mirror = <other-dir>;`, or set `grain = clustered|soft|none;`.
Face-local stamp coordinates start at that face's top-left, rather than the
atlas origin.

A chart or face supports five deterministic patterns:

| Pattern | Required & optional properties | Purpose |
| --- | --- | --- |
| `pattern blotch` | `paint`, `scale` (`vec3<texel>` 1–128), `density` (`ratio` 0–1), `phase` | Organic spotted fur/stone clusters |
| `pattern gradient` | `to`, `axis` (`u\|v\|x\|y\|z`), optional `from`, `space` (`local\|model`), `soft` (`ratio`) | Ordered-dither transition (belly/dorsal/model-wide shading) |
| `pattern border` | `paint`, optional `width` (`1px`–`16px`), `edges` (`all\|top\|bottom\|sides`) | Trim, belts, armor outlines, wood frames |
| `pattern stripe` | `paint`, `axis` (`u\|v\|x\|y\|z`), `period`, optional `width`, `phase` | Feathers, ribs, fur striping, planks |
| `pattern ao` | optional `strength` (`ratio` 0–1), `radius` (`unit` or `texel` <= 16) | 3D contact ambient occlusion from adjacent geometry |

`blotch`, `gradient`, `border`, and `stripe` patterns must precede `stamp`
placement. `ao` accumulates pure-CPU 3D crease shadowing applied with `tone`
before `grain`.

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
  fill = coat;
  grain = none;
  face west { stamp eye { anchor = top_left; offset = (1px, 2px); } }
  face east { mirror = west; }
}
```

| Placement property | Allowed value / semantics |
| --- | --- |
| `at` | Explicit `vec2<texel>` placement; use instead of anchor/offset |
| `anchor` | `top_left`, `top`, `top_right`, `left`, `center`, `right`, `bottom_left`, `bottom`, `bottom_right` |
| `offset` | Required with an anchor; signed texel offset, right/down positive |
| `flip` | `none` (default), `x`, `y`, `xy`; reflects contents within the stamp rectangle |
| `protect` | `true` (default, protects stamped cells), `false` (allows tone/grain modulation), or nonnegative `texel` margin |

Placement never scales the stamp. The complete stamp and protection rectangle
must fit the face. Center placement that falls on half a texel fails rather than
rounding. A flip changes contents, not placement. Later explicit stamps can still
overpaint protected pixels.
