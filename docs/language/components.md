# Components and sockets

Components package model geometry with explicit parameters and typed ports.
An assembly instantiates them with `use`. Contracts are nominal: two contracts
with identical fields but different declaration identities are not interchangeable.
You can import shared rigs and skeletons directly from `"std/model/rig/..."` (`ashfox library std list model/rig`),
or start from the [complete model](model.md#complete-source) for rig contracts (`joint`, `channels`, `limits`, `chain`, `ik_limb`, `anchor`), skeleton `parent_origin` binds, and surfaces.

## Parameters

Declare parameters either inside a component body (`param name: type;` or `param name: type = default;`) or in its parenthesized header (`component Name(param height_scale: number = 1.0, ...) { ... }`). `number` is accepted as an alias for `ratio` and scales dimensional `unit` values and vectors cleanly. Every `use` supplies required (default-free) parameters and required ports via `use alias.Name(p = val) as inst { ... };` or property assignments inside `{ ... }`; omitted parameters with defaults use their declared fallback. Unknown parameter names fail closed with `Did you mean` hints, as do missing required parameters, duplicates, and type mismatches. Use a [closed value type](values.md#closed-value-types), not a stringly typed record.

Fragment replacing the complete model's `Body` component:

```text
export component Body(param size: vec3<unit> = (4u, 4u, 4u), param height_scale: number = 1.0) {
  requires rig skeleton: SampleRig;
  requires surface skin: Skin;
  bind bone root to skeleton.root;
  geometry {
    bone root {
      cube body {
        origin = (-2u, 0u, -2u);
        size = size * height_scale;
        surface = skin.body;
      }
    }
  }
}
```

Its instance in `model sample`:

```text
use Body(height_scale = 1.5) as body {
  skeleton = SampleRig;
  skin = red;
};
```

Parameter references are local names such as `size`. Designs use qualified names
such as `Dimensions.size`. Changing a geometric parameter does not automatically
resize a surface contract; update or parameterize the shared design as well.
Unknown, duplicate, missing and incorrectly typed parameter values fail.

## Port and binding reference

| Declaration or binding | Meaning |
| --- | --- |
| `requires rig skeleton: Rig;` | Rig port that must match the selected skeleton's rig contract |
| `requires surface skin: Skin;` | Surface port requiring that exact surface contract |
| `requires socket mount: Mount;` | Attachment endpoint requiring one incoming connection |
| `provides socket hand: Mount capacity = one;` | Provider accepting one connection; `many` allows several |
| `bind bone root to skeleton.root;` | Bind a component geometry bone to a joint through the rig port |
| `bind socket mount to bone anchor { frame { … } }` | Bind a component socket endpoint to a geometry bone with an explicit local frame |
| Instance `skeleton = Rig;` | Select the rig contract for the component port; it must match the assembly skeleton |
| Instance `skin = concrete_surface;` | Supply a concrete surface that implements the required contract |
| `connect body.hand -> shield.mount;` | Connect a provided endpoint to a required endpoint |

The assembly's `skeleton = ConcreteSkeleton;` selects the implementation.
The `use` block's rig-port binding names its **rig contract**, not the skeleton.
Socket ports are satisfied by `connect`, not by direct property binding.
Only socket providers participate in `connect`; provided ports cannot receive
an assembly binding. Use required rig/surface ports for those dependencies.

## Socket contracts and frames

Fragment inside a model unit:

```text
export socket contract Mount {
  handedness = right;
  frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
}
```

A frame has three signed orthogonal axes. Socket contracts declare orientation
and handedness (`right` or `left`). Concrete endpoints also supply an origin.
The endpoint's frame need not be textually identical to the contract; its
handedness must agree.

Fragment inside a component with geometry bone `anchor`:

```text
requires socket mount: Mount;
bind socket mount to bone anchor {
  frame {
    origin = (0u, 0u, 0u);
    x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1);
  }
}
```

For a provider, declare `provides socket hand: Mount capacity = one;` and bind
`hand` to its geometry bone using the same endpoint syntax. A rig can also
declare a socket tied to one of its own joints:

```text
socket hand: Mount {
  joint = root;
  capacity = one;
  frame {
    origin = (0u, 0u, 0u);
    x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1);
  }
}
```

## Placement and validation

Rig-bound geometry follows the selected skeleton. Do not add a conflicting
position, rotation or pivot to the directly bound geometry bone. A socket-owned
component is placed by its connection. Its declared endpoint determines which
local point aligns with the provider; nearby geometry is never an implicit bind.

Every required socket needs exactly one provider. Providers respect `one` or
`many` capacity. Contract mismatches, missing endpoints, multiple attachment
authorities and connection cycles fail. Connections are directional:
`provider.port -> required.port`.

Skeleton `parent_origin` uses the parent joint's frame; geometry `origin` and
socket-frame `origin` have their own local spaces. See
[rigs and skeletons](model.md#4-rigs-and-skeletons) before authoring offsets.
After changing attachment locations, inspect both rest pose and every motion.
