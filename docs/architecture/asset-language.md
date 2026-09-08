# Asset language syntax

Ashfox source describes an asset's geometry, surfaces, rig, and motions. A
source file is read inside a workspace by the Workbench. Start every source
file with the exact header `ashfox-model 1`, then write one source unit.

The examples in this page are deliberately labeled. A **snippet** is a
fragment to place in a larger source file. A **complete source** includes its
header, unit, declarations, and assembly and can be used as one small asset
source file.

## 1. Source units

A source unit is either a reusable `module` or an entry-oriented `asset`.
Declarations inside a unit can be exported so another unit can refer to them.

**Snippet — two source unit shapes:**

```text
ashfox-model 1
module creatures {
  // reusable declarations go here
}
```
```text
ashfox-model 1
asset fox {
  // declarations and the exported asset assembly go here
}
```

Use braces for blocks and end property assignments with `;`. A component
`use` also ends with `;` after its closing brace. Keep one
unit per source file. The source header is versioned; do not replace it with a
different model or language name.

### Imports and names

Imports use a quoted path and a local alias. A declaration from an imported
file is written as `alias.name`; a declaration in the same unit uses its local
name.

**Snippet — importing a reusable animation module:**

```text
import "./animation.ashfox" as animation;

export asset griffin {
  skeleton = animation.GriffinSkeleton;
  motion = animation.idle;
}
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
| `1ratio` | scale ratio |
| `16` | an integer, such as density or fps |
| `true`, `false` | a boolean |
| `#d16b3a` | a color |

Vectors use parentheses, for example `(0u, 4u, 0u)`,
`(0deg, 10deg, 0deg)`, or `(1ratio, 1ratio, 1ratio)`. Expressions can use
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
- `asset` for the selected skeleton, motions, component instances, and
  optional socket connections.

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
| `cube` | `origin`, `size`, one surface chart | `position`, `rotation`, `pivot`, `visible`, `inflate`, `mirror` |
| `plane` | `origin`, `size`, `u-axis`, `v-axis`, one surface chart | `position`, `rotation`, `visible` |
| `locator` | none | `position`, `rotation`, `visible` |
| `face` inside a cube | none | `enabled`, `rotation` |

Bones can contain bones, cubes, planes, and locators. Cubes can contain face
blocks named `north`, `south`, `east`, `west`, `up`, or `down`. A face rotation
is one of `0`, `90`, `180`, or `270`.

`cube` sizes and `plane` sizes must be positive. A plane's `size` is a two
component unit vector and its `u-axis` and `v-axis` are distinct signed unit
axes. A bound geometry bone already receives its placement from the rig
binding, so do not add a competing `position`, `rotation`, or `pivot` to that
bone.

### Surface contracts and surfaces

A surface contract declares an atlas and the named charts that geometry may
use. The concrete surface supplies the material and texture recipe. A chart's
dimensions are part of the contract; a box chart used by a cube must match the
cube's UV net exactly.

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
    background-alpha = 255;
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
recipes declare an atlas, background, palette, and charts, with exactly one
`grain clustered { seed = ...; }` block. Use `tone voxel` for the pixel shading
shown here and add face-local stamps for deliberate marks. The precision guide
shows exact pixel marks and anchored stamps.

## 4. Rigs and skeletons

A rig contract gives joints their names, parent relationships, local frames,
allowed motion channels, and optional mirror partners. A skeleton implements
that contract by giving every joint a concrete rest origin and frame.

**Snippet — a rig and its skeleton:**

```text
export rig contract CreatureRig {
  handedness = right;
  frame {
    x = (1, 0, 0);
    y = (0, 1, 0);
    z = (0, 0, 1);
  }
  joint root {
    parent = none;
    role = root;
    frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
    channels = (rotation, scale);
    mirror = none;
  }
  joint head {
    parent = root;
    role = head;
    frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
    channels = rotation;
    mirror = none;
  }
}

export skeleton CreatureSkeleton implements CreatureRig {
  bind root {
    parent-origin = (0u, 0u, 0u);
    frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
  }
  bind head {
    parent-origin = (0u, 4u, 0u);
    frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
  }
}
```

Each joint declares `channels = rotation`, `channels = scale`, or both as a
tuple. A motion can only use channels allowed by its joint. `parent` and
`mirror` name joints; use `none` when a joint has no parent or mirror. Frames
use signed orthogonal axes, and each skeleton bind supplies its rest `parent-origin`
and frame explicitly.

A skeleton bind uses **`parent-origin`**, measured in the parent joint's frame.
A root uses the model frame. If an unrotated torso is at `y = 13u` and its
shoulder should be at model `y = 19.5u`, bind the shoulder with
`parent-origin = (6.5u, 6.5u, 0u)` for a shoulder at model `x = 6.5u`.
The parent frame rotates or reflects this offset before placing the child.
The ambiguous skeleton property `origin` is rejected; it has no alias.
Geometry `origin` and socket-frame `origin` keep their own documented spaces.

## 5. Motions

A motion names the rig contract it animates. Tracks address one joint and one
supported channel: `rotation` or `scale`.

**Snippet — a rest-relative rotation motion:**

```text
export motion idle for CreatureRig {
  duration = 1s;
  fps = 20;
  loop = loop;
  rest-relative = true;
  track head.rotation {
    key 0s = (0deg, 0deg, 0deg) linear;
    key 0.5s = (0deg, 4deg, 0deg) linear;
    key 1s = (0deg, 0deg, 0deg) linear;
  }
}
```

Motion properties are required:

- `duration` is a positive number of seconds.
- `fps` is an integer from `1` through `240`.
- `loop` is `once`, `loop`, or `hold_on_last_frame`.
- `rest-relative` must be `true`.

Key times must be within the duration and strictly increasing. Every key ends
with one interpolation name: `linear`, `step`, or `catmullrom`. The name on a
key controls the segment from that key to the next one. `linear` blends the
values, `step` holds the starting value, and `catmullrom` makes a smooth curve
using neighboring keys.

Rotation keys use `vec3<degree>` values. Scale keys use positive
`vec3<ratio>` values such as `(1ratio, 1ratio, 1ratio)`, and their rig joint
must allow the `scale` channel. A motion key cannot target `position` or `ik`;
this language currently supports rest-relative rotation and scale only.

## 6. Assembly

An asset assembly selects one concrete skeleton, zero or more distinct motions,
and one or more component instances. It also sets the fixed density and
forward direction used by the asset.

**Snippet — selecting a skeleton, motions, and component:**

```text
export asset fox {
  settings { density = 16; forward = north; }
  skeleton = CreatureSkeleton;
  motion = idle;
  motion = walk;
  use CreatureBody as body {
    bind skeleton = CreatureRig;
    bind skin = warm_fur;
  };
}
```

`density` is currently `16`; `forward` is `north`, `south`, `east`, or
`west`. A `use` creates a named component instance and binds every required
port. The `skeleton` binding names the concrete implementation, while the
component's rig port names the matching rig contract. An asset may select
multiple different motions, but each selected motion must use the same rig as
the skeleton and may appear only once.

For socket-anchored parts, declare explicit socket contracts and connect
provider and required endpoints in the assembly. Connections are written
`provider.port -> required.port`; Ashfox does not infer attachments from
nearby geometry.

**Snippet — explicit socket connection:**

```text
connect body.hand -> shield.mount;
```

## Complete source

The following is a complete one-file source for a small animated cube. It is
intentionally compact; use the sections above or the [precision modeling
guide](../guides/precision-modeling.md) when you need larger geometry, shared
dimensions, or pixel anchors.

**Complete source — `sample.ashfox`:**

```text
ashfox-model 1
asset sample {
  export rig contract SampleRig {
    handedness = right;
    frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
    joint root {
      parent = none;
      role = root;
      frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
      channels = rotation;
      mirror = none;
    }
  }
  export skeleton SampleSkeleton implements SampleRig {
    bind root {
      parent-origin = (0u, 0u, 0u);
      frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
    }
  }
  export surface contract Skin {
    atlas { width = 16px; height = 8px; }
    chart body box { width = 16px; height = 8px; coverage = opaque; }
    material = opaque;
  }
  export surface red: Skin {
    material = opaque;
    texture atlas {
      atlas = (16px, 8px);
      background = shade;
      background-alpha = 255;
      palette { shade = #21100c; body = (#7d2417, #c94f2a, #ef8141); }
      chart body box { origin = (0px, 0px); fill = body; }
      grain clustered { seed = 23; }
      tone voxel;
    }
  }
  export component Body {
    requires rig skeleton: SampleRig;
    requires surface skin: Skin;
    bind bone root to skeleton.root;
    geometry {
      bone root {
        cube body {
          origin = (-2u, 0u, -2u);
          size = (4u, 4u, 4u);
          surface = skin.body;
        }
      }
    }
  }
  export motion idle for SampleRig {
    duration = 1s;
    fps = 20;
    loop = loop;
    rest-relative = true;
    track root.rotation {
      key 0s = (0deg, 0deg, 0deg) linear;
      key 0.5s = (0deg, 4deg, 0deg) linear;
      key 1s = (0deg, 0deg, 0deg) linear;
    }
  }
  export asset sample {
    settings { density = 16; forward = north; }
    skeleton = SampleSkeleton;
    motion = idle;
    use Body as body {
      bind skeleton = SampleRig;
      bind skin = red;
    };
  }
}
```
