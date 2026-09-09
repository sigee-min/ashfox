# Components and sockets

Components package model geometry with explicit parameters and typed ports.
An assembly instantiates them with `use`. Contracts are nominal: two contracts
with identical fields but different declaration identities are not interchangeable.
Start with the [complete model](model.md#complete-source) for its rig and surface.

## Parameters

Declare `param name: type;` inside a component. Parameters have no default value;
every instance supplies each declared parameter exactly once with `set`.
Use a [closed value type](values.md#closed-value-types), not a stringly typed record.

Fragment replacing the complete model's `Body` component:

```text
export component Body {
  param size: vec3<unit>;
  requires rig skeleton: SampleRig;
  requires surface skin: Skin;
  bind bone root to skeleton.root;
  geometry {
    bone root {
      cube body {
        origin = (-2u, 0u, -2u);
        size = size;
        surface = skin.body;
      }
    }
  }
}
```

Its instance in `export asset sample`:

```text
use Body as body {
  set size = (4u, 4u, 4u);
  bind skeleton = SampleRig;
  bind skin = red;
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
| Instance `bind skeleton = Rig;` | Select the rig contract for the component port; it must match the assembly skeleton |
| Instance `bind skin = concrete_surface;` | Supply a concrete surface that implements the required contract |
| `connect body.hand -> shield.mount;` | Connect a provided endpoint to a required endpoint |

The assembly's `skeleton = ConcreteSkeleton;` selects the implementation.
The `use` block's rig-port bind names its **rig contract**, not the skeleton.
Socket ports are satisfied by `connect`, not by `bind port = …`.
Only socket providers participate in `connect`; provided ports cannot receive
an assembly `bind`. Use required rig/surface ports for those dependencies.

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

Skeleton `parent-origin` uses the parent joint's frame; geometry `origin` and
socket-frame `origin` have their own local spaces. See
[rigs and skeletons](model.md#4-rigs-and-skeletons) before authoring offsets.
After changing attachment locations, inspect both rest pose and every motion.
