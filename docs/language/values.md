# Values and expressions

This page applies to model `asset` and `module` units. Sprite and sound
properties use their own [literal grammars](README.md#the-three-value-grammars).

## Tokens and punctuation

Names are case-sensitive ASCII identifiers: `[A-Za-z_][A-Za-z0-9_]*`.
Use underscores in authored names. Hyphenated property keywords such as
`parent-origin` are language-defined; hyphens in expressions mean subtraction.
Workspace export IDs have a separate lowercase naming rule.

Whitespace and newlines do not terminate declarations. Write `;` after
assignments, imports, parameter/port declarations, checks and motion keys.
A component `use` block ends with `};`; ordinary declaration blocks end with `}`.
Both `//` line comments and non-nested `/* … */` comments are supported.

Strings use double quotes and remain on one line. The model/sprite lexer allows
only escaped quote and escaped backslash (`\"` and `\\`). Colors use exactly
six hexadecimal digits after `#`; alpha belongs to texture properties.

Numeric literals use decimal notation (`4`, `0.5`, `.5`) with an optional unit.
Use unary `-` for negatives. Scientific notation, `NaN`, and `Infinity` are not
model numeric literals. Parentheses group expressions or form tuples;
square brackets also form vectors. Vector values must match the expected arity.

## Closed value types

These are the available `design`, component `param` and surface `slot` types.
There is no arbitrary generic type constructor.

| Type | Example | Meaning |
| --- | --- | --- |
| `integer` | `16` | Exact unitless integer |
| `unit` | `4u` | Model distance |
| `texel` | `16px`, `16tx` | Texture distance; pixel placement must be integral |
| `degree` | `15deg` | Rotation angle |
| `second` | `0.5s` | Motion time |
| `ratio` | `0.5ratio` | Dimensionless ratio with an explicit type |
| `bool` | `true` | `true` or `false` |
| `color` | `#c94f2a` | RGB color |
| `vec2<unit>` | `(2u, 3u)` | Two model distances |
| `vec3<unit>` | `(2u, 3u, 4u)` | Position or size |
| `vec3<degree>` | `(0deg, 15deg, 0deg)` | Euler rotation |
| `vec3<ratio>` | `(1ratio, 1ratio, 1ratio)` | Scale/alignment ratios |
| `vec2<texel>` | `(0px, 8px)` | Atlas or face pixel position |
| `texel-rect` | `(0px, 0px, 4px, 4px)` | Four texel components |

Write explicit units at API boundaries. Plain integer literals can acquire a
field's expected numeric unit in supported typed contexts; explicit incompatible
units are still rejected. This is not a general conversion between units.

## Operators

Precedence below runs from tightest to loosest. Binary operators associate left
to right within a row. Use parentheses to make intended grouping visible.

| Operators | Rules |
| --- | --- |
| Member access and calls | `.x`, `.y`, `.z` on matching vectors; built-in calls only |
| Unary `+`, `-` | Numeric sign |
| `*`, `/`, `%` | Multiplication has at most one dimensional scalar operand; division accepts a plain divisor or matching units; remainder accepts integers |
| `+`, `-` | Matching units; matching vector shapes for vector addition/subtraction |
| `<`, `<=`, `>`, `>=` | Numeric values with compatible units; returns `bool` |
| `==`, `!=` | Equality/inequality; returns `bool` |

Vector scaling uses a plain scalar. Model arithmetic is exact rational arithmetic:
`1u / 2` is valid, but `1 / 2` cannot be represented as an `integer`.
`4u / 2u` produces integer `2`. Multiplying `2u * 3u` does not create an area type.
Division/remainder by zero fails. There are no `&&`, `||`, `!`, ternary expressions
or implicit rounding; use separate named checks for separate conditions.

## Built-in functions

| Function | Arguments and result |
| --- | --- |
| `abs(x)` | One numeric value; preserves its unit |
| `min(a, …)`, `max(a, …)` | One or more numeric arguments of one unit |
| `clamp(x, lower, upper)` | Three numeric arguments of one unit; author an ordered interval |
| `vec2(a, b)`, `vec3(a, b, c)` | Numeric arguments with a supported shared vector unit |
| `texels(length, density)` | Nonnegative `unit` length and positive integer pixels per unit; returns integral `texel`, without rounding |
| `mirror_x(point, plane)` | `vec3<unit>` point and `unit` plane coordinate; reflects X. `mirror_y` and `mirror_z` reflect the other axes |
| `box_origin(anchor, size, alignment)` | `vec3<unit>`, positive `vec3<unit>`, and `vec3<ratio>` in `[0,1]`; returns `anchor - size * alignment` componentwise |

Reflection functions compute points only. They do not duplicate geometry,
change joint frames or flip texture contents.

## Designs and dependencies

Fragment inside a model unit:

```text
export design Dimensions {
  width: unit = 4u;
  height: unit = 4u;
  depth: unit = 4u;
  size: vec3<unit> = (Dimensions.width, Dimensions.height, Dimensions.depth);
  netWidth: texel = texels(Dimensions.width * 2 + Dimensions.depth * 2, 1);
  check positiveWidth = Dimensions.width > 0u;
  check fitsAtlas = Dimensions.netWidth <= 32px;
}
```

A field is referenced as `Dimensions.width`, even within its own design.
An imported exported design uses `alias.Dimensions.width`. Vector fields allow
component access such as `Dimensions.size.x`. Forward references are allowed;
dependency cycles, duplicate names and namespace shadowing are rejected.
Every `check` must evaluate to `bool` and be true for the candidate to compile.

A design is an immutable set of values and assertions. A check does not measure
the rendered model or move a part into place. Pass values into
[component parameters](components.md#parameters) to reuse geometry. See the
[complete precision example](../guides/precision-modeling.md) for a compiled design
that resizes geometry and its UV net while preserving one-pixel eyes.
