# Model syntax reference

Ashfox source describes an asset's geometry, surfaces, rig, and motions. A
model source compiles directly through the [CLI](../guides/cli.md). Start every source
file with the exact header `ashfox 1`, then write one source unit.

The examples in this page are deliberately labeled. A **snippet** is a
fragment to place in a larger source file. A **complete source** includes its
header, unit, declarations, and assembly and can be used as one small asset
source file.

For the full specification, see [values and expressions](values.md),
[components and sockets](components.md), and [model textures](textures.md).
Other asset kinds share `ashfox 1` with [sprite](sprites.md), [sound](sounds.md), and [structure](structures.md) declarations.

## 1. Source units

This page covers model units: reusable `module` and entry-oriented `model`.
For other asset kinds, see [sprites](../guides/sprites.md) and [sounds](../guides/sounds.md).
Declarations inside a unit can be exported so another unit can refer to them.

**Snippet — two source unit shapes:**

```text
ashfox 1
module creatures {
  // reusable declarations go here
}
```
```text
ashfox 1
model fox {
  // declarations and the exported model assembly go here
}
```

Use braces for blocks and end property assignments with `;`. A component
`use` also ends with `;` after its closing brace. Keep one
unit per source file. Start every file with `ashfox 1`.

### Imports and names

Imports use a quoted path and a local alias. A declaration from an imported
file is written as `alias.name`; a declaration in the same unit uses its local
name.

**Snippet — importing a reusable animation module:**

```text
import "./animation.ashfox" as animation;

skeleton = animation.GriffinSkeleton;
motions = [animation.idle];
```

The path, alias, declaration name, and every required binding are explicit.
Ashfox does not choose a rig, surface, chart, or joint from a similar name.
Use `export` on a declaration that another source unit or the entry assembly
must use.

## 2. Values and declarations

Assignments use `name = expression;`. Common literal units are:

| Literal | Meaning |
| --- | --- |
| `4u` | model units for positions and sizes |
| `16px` or `16tx` | texture pixels |
| `12deg` | rotation degrees |
| `1.5s` | motion time in seconds |
| `0.5` or `50%` | scale or strength ratio |
| `16` | an integer, such as density or fps |
| `true`, `false` | a boolean |
| `#d16b3a` | a color |

Vectors use parentheses, for example `(0u, 4u, 0u)`,
`(0deg, 10deg, 0deg)`, or `(1, 1, 1)`. Expressions can use
named values, arithmetic, comparisons, and vector members such as `.x`, `.y`,
and `.z`. Keep the unit that the surrounding declaration expects; `4u` and
`4px` are different values.

The supported declaration families are:

- `design` for exact shared dimensions and named checks. See [Precision
  modeling](../guides/precision-modeling.md) for the complete tested pattern.
- `rig contract` and `skeleton` for motion joints and their concrete rest
  frames.
- `surface contract` and `surface` for chart layouts, materials, and pixels.
- `component` for reusable geometry with typed ports.
- `motion` for named rig-joint tracks.
- `settings`, `skeleton`, `motions`, `use`, and `connect` statements directly inside `model` for the selected skeleton, motions, component instances, and optional socket connections.

## 3. Geometry and surfaces

### Components and geometry

A component owns a reusable geometry tree. A usual model component requires
one rig contract and one surface contract, binds its geometry bones to rig
joints, and assigns a chart to every cube or plane.

**Snippet — a rig-bound component:**

```text
export component CreatureBody {
  requires rig skeleton: CreatureRig;
  requires surface skin: Fur;
  bind bone root to skeleton.root;
  geometry {
    bone root {
      cube torso {
        origin = (-2u, 0u, -2u);
        size = (4u, 4u, 4u);
        surface = skin.body;
      }
    }
  }
}
```

Geometry nodes may be nested as follows:

| Node | Required properties | Useful optional properties |
| --- | --- | --- |
| `bone` | none | `position`, `rotation`, `pivot`, `visible` |
| `cube` | `origin`, `size`, one surface chart | `position`, `rotation`, `pivot`, `visible`, `inflate`, `mirror`, `mirror_x` |
| `plane` | `origin`, `size`, `u_axis`, `v_axis`, one surface chart | `position`, `rotation`, `pivot`, `visible`, `mirror_x` |
| `locator` | none | `position`, `rotation`, `visible` |
| `face` inside a cube | none | `enabled`, `rotation` |

Bones can contain bones, cubes, planes, and locators. Cubes can contain face
blocks named `north`, `south`, `east`, `west`, `up`, or `down`. A face rotation
is one of `0`, `90`, `180`, or `270`. Giving a `cube` or `plane` `mirror_x = <id>;`
synthesizes a sibling mirrored across `x = 0` with flipped `rotation.y`/`rotation.z`,
mirrored UV orientation, and swapped `east`/`west` face overrides.

`cube` sizes and `plane` sizes must be positive. A plane's `size` is a two
component unit vector and its `u_axis` and `v_axis` are distinct signed unit
axes. A bound geometry bone already receives its placement from the rig
binding, so do not add a competing `position`, `rotation`, or `pivot` to that
bone.

### Surface contracts and surfaces

A surface contract declares the named charts that geometry may use. Atlas
dimensions and chart `width`/`height` may be omitted for deterministic compiler
auto-inference and auto-packing from bound geometry dimensions, or specified
explicitly when an external layout must be locked.

**Snippet — a chart contract and concrete surface:**

```text
export surface contract Fur {
  atlas { width = 16px; height = 8px; }
  chart body box {
    width = 16px;
    height = 8px;
    coverage = opaque;
  }
  material = opaque;
}

export surface warm_fur: Fur {
  material = opaque;
  texture atlas {
    atlas = (16px, 8px);
    background = shade;
    background_alpha = 255;
    palette {
      shade = #4a170f;
      coat = (#4a170f, #a83a1f, #e06b32);
    }
    chart body box {
      origin = (0px, 0px);
      fill = coat;
    }
    grain clustered { seed = 23; }
    tone voxel;
  }
}
```

Contracts can declare `box` or `flat` charts. Chart coverage is `opaque`,
`binary`, or `optional`; material is `opaque`, `cutout`, or `double`. Texture
recipes declare a background, palette, and charts, with optional `grain`
(`clustered`, `soft`, or `none`, overridable per chart or face) and `tone`
(`voxel` or `painterly`). See [model textures](textures.md) for patterns,
face fills/mirroring, 3D contact AO, and stamps.

## 4. Rigs and skeletons

A rig contract gives joints their names, parent relationships, local frames,
allowed motion channels, and optional mirror partners. A skeleton implements
that contract by giving every joint a concrete rest origin and frame.

**Snippet — a rig and its skeleton:**

```text
export rig contract CreatureRig {
  joint root {
    parent = none;
    role = root;
    channels = (rotation, scale);
  }
  joint head {
    parent = root;
    role = head;
    channels = rotation;
  }
}

export skeleton CreatureSkeleton implements CreatureRig {
  bind root {
    parent_origin = (0u, 0u, 0u);
  }
  bind head {
    parent_origin = (0u, 4u, 0u);
  }
}
```

Each joint declares `position`, `rotation`, and/or `scale` channels (for example
`channels = (position, rotation);`), plus optional `limits`, `chain`, `ik_limb`,
and `anchor` blocks. A motion can only use channels allowed by its joint. `parent` and
`mirror` name joints (omit `mirror` or set `mirror = none;` when absent; identity `handedness = right` and `frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }` may be omitted). Frames
use signed orthogonal axes, and each skeleton bind supplies its rest `parent_origin`
and any non-identity frame explicitly.

A skeleton bind uses **`parent_origin`**, measured in the parent joint's frame.
A root uses the model frame. If an unrotated torso is at `y = 13u` and its
shoulder should be at model `y = 19.5u`, bind the shoulder with
`parent_origin = (6.5u, 6.5u, 0u)` for a shoulder at model `x = 6.5u`.
The parent frame rotates or reflects this offset before placing the child.
The ambiguous skeleton property `origin` is rejected; it has no alias.
Geometry `origin` and socket-frame `origin` keep their own documented spaces.

## 5. Motions

A motion names the rig contract it animates. Tracks address one joint and one
supported channel: `position`, `rotation`, or `scale`.

**Snippet — a rest-space relative rotation motion:**

```text
export motion idle for CreatureRig {
  duration = 1s;
  fps = 20;
  loop = loop;
  track head.rotation {
    key 0s = (0deg, 0deg, 0deg) linear;
    key 0.5s = (0deg, 4deg, 0deg) linear;
    key 1s = (0deg, 0deg, 0deg) linear;
  }
}
```

Motion properties:

- `duration` is a positive number of seconds.
- `fps` is an integer from `1` through `240`.
- `loop` is `once`, `loop`, or `hold_on_last_frame`.
- `rest_relative` defaults to `true`.

Key times must be within the duration and strictly increasing. Each key ends
with an interpolation curve name (`linear`, `step`, `smooth`, `ease_in`,
`ease_out`, `ease_in_out`, `cubic`, `snap`, `anticipate`, `overshoot`, `bounce`,
`elastic`, or `catmullrom`) and optional curve arguments.

Position keys use `vec3<unit>` offsets, rotation keys use `vec3<degree>` values
(baked with quaternion-native SLERP interpolation), and scale keys use positive
`vec3<ratio>` values such as `(1, 1, 1)`; the target rig joint must allow the
corresponding channel. Motions also support `wave`, `pose`, `at ... pose`,
`layer`, `ik` (`foot_lock`), `secondary` (`chain`/`joint`), combat operations
(`squash`, `smear`, `hitstop`, `recoil`), and `cue` (`sound`, `vfx`, `event`).

## 6. Assembly

A `model` unit selects one concrete skeleton, zero or more distinct motions (`motions = [...]`),
and one or more component instances directly in its body. It also sets the fixed density and
forward direction used by the model.

**Snippet — selecting a skeleton, motions, and component:**

```text
model fox {
  settings { density = 16; forward = north; profile = creature; }
  skeleton = CreatureSkeleton;
  motions = [idle, walk];
  use CreatureBody as body {
    skeleton = CreatureRig;
    skin = warm_fur;
  }
}
```

`density` is currently `16`; `forward` is `north`, `south`, `east`, or
`west`. The optional `profile` (`creature`, `prop`, or `block`) declares the
asset quality audit rubric weighting used by `ashfox check`.
A `use` creates a named component instance and binds every required
port. The `skeleton` property names the concrete implementation.
The `use` block's rig-port binding names the matching rig contract. A model may select
multiple different motions in `motions = [...]`, but each selected motion must use the same rig as
the skeleton and may appear only once.

For socket-anchored parts, declare explicit socket contracts and connect
provider and required endpoints in the assembly. Connections are written
`provider.port -> required.port`; Ashfox does not infer attachments from
nearby geometry.

**Snippet — explicit socket connection:**

```text
connect body.hand -> shield.mount;
```

### Authoring conventions & hygiene

Compile-time checks enforce clean modular `.ashfox` source structure across every
standalone entry and workspace:

- `asset.unused-import` — remove imported module aliases that no declaration references.
- `asset.unused-declaration` — remove dead local declarations in an entry or unused private helpers in a module.
- `asset.texture.unused-stamp` — apply every declared `stamp` on at least one chart face or remove it.
- `asset.monolithic-entry` — split oversized entries or creature assemblies (>= 20 primitives with inline surfaces) into focused modules (`rig`, `surface`, `body`).
- `asset.mixed-module-concerns` — do not combine rig contracts/motion, concrete surfaces, and geometry components inside one imported module file.

## Complete source

The following is a complete one-file source for a small animated cube. It is
intentionally compact; use the sections above or the [precision modeling
guide](../guides/precision-modeling.md) when you need larger geometry, shared
dimensions, or pixel anchors.

**Complete source — `sample.ashfox`:**

```ashfox
ashfox 1
model sample {
  export rig contract SampleRig {
    joint root {
      parent = none;
      role = root;
      channels = rotation;
    }
  }
  export skeleton SampleSkeleton implements SampleRig {
    bind root {
      parent_origin = (0u, 0u, 0u);
    }
  }
  export surface contract Skin {
    atlas { width = 32px; height = 32px; }
    chart base box { width = 16px; height = 4px; coverage = opaque; }
    chart body box { width = 16px; height = 8px; coverage = opaque; }
    chart cap box { width = 12px; height = 3px; coverage = opaque; }
    material = opaque;
  }
  export surface red: Skin {
    material = opaque;
    texture atlas {
      atlas = (32px, 32px);
      background = bg;
      background_alpha = 255;
      palette {
        bg = #2e201b;
        shade = (#301f19, #4d3228, #70493a);
        stone = (#35353d, #565663, #828291);
        body = (#7d2417, #c94f2a, #ef8141);
        gold = (#7a5214, #c98f28, #ffcf5c);
        eye = (#b89e78, #fff2d6, #ffffff);
      }
      stamp crest { pixels = ".gg./gggg/.gg."; g = gold; }
      chart base box {
        origin = (0px, 0px); fill = stone; grain = clustered;
        pattern border { paint = shade; width = 1px; edges = bottom; }
        pattern ao { strength = 0.4; radius = 0.7u; }
      }
      chart body box {
        origin = (16px, 0px); fill = body; grain = soft;
        pattern gradient { from = shade; to = body; axis = y; space = model; soft = 0.15; }
        pattern ao { strength = 0.35; radius = 0.6u; }
        face north { stamp crest { at = (0px, 0px); protect = true; } }
      }
      chart cap box {
        origin = (0px, 16px); fill = gold; grain = none;
        pattern border { paint = eye; width = 1px; edges = top; }
        pattern ao { strength = 0.35; radius = 0.6u; }
      }
      grain clustered { seed = 23; }
      tone painterly;
    }
  }
  export component Body {
    param dimensions: vec3<unit>;
    requires rig skeleton: SampleRig;
    requires surface skin: Skin;
    bind bone root to skeleton.root;
    geometry {
      bone root {
        cube base { origin = (-3u, 0u, -3u); size = (6u, 2u, 2u); surface = skin.base; }
        cube body {
          origin = (-2u, 2u, -2u);
          size = dimensions;
          surface = skin.body;
        }
        cube cap {
          origin = (-2u, 6u, -2u);
          size = (4u, 1u, 2u);
          surface = skin.cap;
        }
      }
    }
  }
  export motion idle for SampleRig {
    duration = 1s;
    fps = 20;
    loop = loop;
    track root.rotation {
      key 0s = (0deg, 0deg, 0deg) linear;
      key 0.5s = (0deg, 4deg, 0deg) linear;
      key 1s = (0deg, 0deg, 0deg) linear;
    }
  }
  settings { density = 16; forward = north; profile = block; }
  skeleton = SampleSkeleton;
  motions = [idle];
  use Body as body {
    dimensions = (4u, 4u, 4u);
    skeleton = SampleRig;
    skin = red;
  }
}
```
