# Asset language

Every Ashfox source file begins with the exact header `ashfox-model 1` and
contains one `module` or one `asset` unit. Source files are only meaningful
inside a validated workspace: the package manifest names entries and modules,
and the exact lock closes every dependency.

This is a nominal asset language, not a general programming language. Reuse is
expressed with exported contracts, modules, typed ports, and explicit assembly.
There are no classes, inheritance, mixins, structural matching, wildcard
imports, implicit index files, runtime loading, or target-specific branches.

## Source units and imports

An entry source exports exactly the asset named by its package entry:

```text
ashfox-model 1
asset fox {
  import "./rig.ashfox" as rig;
  import "./surface.ashfox" as surface;
  import "./body.ashfox" as body;

  export asset fox {
    settings { density = 16; forward = north; }
    skeleton = rig.CreatureSkeleton;
    motion = rig.idle;
    use body.CreatureBody as body {
      bind skeleton = rig.CreatureRig;
      bind skin = surface.warm_fur;
    };
  }
}
```

Imports are quoted explicit paths plus a required local alias. A qualified
reference contains that alias and one exported declaration name. Imports are
resolved only through the owning package manifest and exact workspace lock.

## Rig and skeleton

For exact shared `design` fields, named boolean checks, construction datums,
pixel-grid conversion, and face-local stamp anchors, see the executable
[precision modeling guide](../guides/precision-modeling.md). Imported design
values use `alias.Design.field`; nominal declaration references remain
`alias.Name`. Design values are resolved and erased before Typed HIR.

A rig contract owns the semantic joint tree, signed frames, allowed channels,
mirror pairs, and sockets. A skeleton implements exactly one nominal rig and
binds every required joint to a concrete rest origin and frame.

```text
export rig contract CreatureRig {
  handedness = right;
  frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
  joint root {
    parent = none; role = root;
    frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
    channels = (rotation, scale); mirror = none;
  }
}

export skeleton CreatureSkeleton implements CreatureRig {
  bind root {
    origin = (0u, 0u, 0u);
    frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
  }
}
```

Joint `parent` belongs to the nominal rig contract. It is not an arbitrary
scene-parent property. Component geometry uses lexical bone nesting and
explicit rig/socket bindings.

## Surface contract and surface

A surface contract owns exact atlas and chart ABIs. A concrete surface owns
material and texture pixels. Geometry consumes a chart through a typed surface
port, so unrelated texture and UV owners cannot be paired.

```text
export surface contract Fur {
  atlas { width = 16px; height = 8px; }
  chart body box { width = 16px; height = 8px; coverage = opaque; }
  material = opaque;
}

export surface warm_fur: Fur {
  material = opaque;
  texture atlas {
    atlas = (16px, 8px);
    background = shadow; background-alpha = 255;
    palette { shadow = #4a170f; coat = (#4a170f, #a83a1f, #e06b32); }
    chart body box { origin = (0px, 0px); fill = coat; }
    grain clustered { seed = 23; }
    tone voxel;
  }
}
```

Charts are explicit `box` or `flat` layouts with fixed texel dimensions.
Palette roles, stamps, `pattern blotch`, seed-only clustered grain, and voxel
tone are deterministic source decisions. The compiler does not invent charts,
pack UVs, repaint a failed source, or create a target-specific texture fork.

## Component and assembly

A component owns reusable lexical geometry and closed typed parameters/ports.
It cannot capture caller locals or search for a nearby attachment.

```text
export component CreatureBody {
  requires rig skeleton: rig.CreatureRig;
  requires surface skin: surface.Fur;
  bind bone root to skeleton.root;
  geometry {
    bone root {
      cube torso {
        origin = (-2u, 0u, -2u); size = (4u, 4u, 4u);
        surface = skin.body;
      }
    }
  }
}
```

Component parameters use the closed value types implemented by the parser:
`unit`, `texel`, `degree`, `second`, `ratio`, `bool`, `color`, `integer`,
`vec2<unit>`, `vec3<unit>`, `vec3<degree>`, `vec3<ratio>`, `vec2<texel>`, and
`texel-rect`. Every parameter is assigned once by name. Ports are bound to an
exact nominal rig, surface, or socket. Socket connections require compatible
contracts, capacities, and explicit frames.

## Motion

A motion is exported for one nominal rig. Tracks address semantic joints and
must name `rotation` or `scale`; position, IK, root-motion inference, and
name-based retargeting are rejected.

```text
export motion idle for CreatureRig {
  duration = 1s; fps = 20; loop = loop; rest-relative = true;
  track root.rotation {
    key 0s = (0deg, 0deg, 0deg) linear;
    key 0.5s = (0deg, 2deg, 0deg) linear;
    key 1s = (0deg, 0deg, 0deg) linear;
  }
}
```

The compiler maps rig-frame channels to the chosen skeleton and produces
concrete canonical channels. An exporter never retargets or silently drops a
channel.

## Exact values and failure

Numbers remain exact rational values during parsing and type checking. Units
are explicit where required. Frames use signed orthonormal axes. Names are
ASCII identifiers, and declaration visibility is explicit with `export`.

All source-owned failures contain a package, logical path, and span. Import,
declaration, graph, type, instantiation, texture, geometry, motion, and
canonical validation are fail-closed: a diagnostic returns no partial model.

The checked-in
[`shared-creatures.ashfoxworkspace`](../../examples/shared-creatures.ashfoxworkspace)
is the executable reference. It contains two entries that share the same rig,
skeleton, motion, surface, and component modules.
