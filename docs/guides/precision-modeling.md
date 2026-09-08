# Precision modeling with block forms and pixel detail

The precision compiler keeps the existing cube/plane product and pixel style.
It adds exact shared design values, construction relations, named checks,
face-local stamp anchors, and read-only measurements. It does not introduce
smooth CAD solids, automatic fitting, a general constraint solver, or automatic
atlas packing. Workspace source remains the only durable authority.

## Shared dimensions and construction datums

Declare `design` inside a module or asset source unit. Fields have explicit
types and one expression each. Use `Design.field` locally or
`alias.Design.field` for an exported design in an explicitly imported module.
Vector fields also support `.x`, `.y`, and `.z` where that axis exists.

Forward references are allowed. Cycles, duplicate names, namespace shadowing,
missing fields, private imports, and unit mismatches fail closed. A named
`check` requires a boolean expression and rejects the candidate when false.
Checks describe authored relationships; they do not measure the rendered model
or move geometry to make a condition true.

Construction datums are named unit vectors. They do not add bones or another
placement authority. The existing rig, skeleton, and socket contracts still
own motion and assembly.

| Expression | Contract |
| --- | --- |
| `texels(length, density)` | Nonnegative `unit` length, positive `integer` pixels per unit; the result must be an integral `texel` value. No rounding. |
| `mirror_x(point, plane)` | Reflect a `vec3<unit>` point about an explicit X plane coordinate in `unit`. Y and Z variants are also available. This does not mirror geometry, frames, or UVs. |
| `box_origin(anchor, size, alignment)` | Return `anchor - size * alignment` componentwise. Size is positive `vec3<unit>`; alignment is `vec3<ratio>` with each component in `[0,1]`. |

Keep arithmetic exact. A half-unit origin can be valid while a fractional
chart dimension is not. Geometry, skeleton origins, chart dimensions, and
surface recipe values can consume the same design. The resulting surface
contract remains nominal and concrete; chart size matching is never inferred
from an unrelated surface. Atlas placement is explicit: declare complete
`vec2<texel>` design fields for calculated chart origins.

## Executable head study

This complete source is a small modeling study, not a new visual style. Place
it at an entry path in a current locked workspace. Change `width` from `4u` to
`6u`: the box and chart dimensions follow together, while both eye stamps stay
exactly one pixel wide. The atlas stays explicit and bounded.

```text
ashfox-model 1
asset study {
  export design Dimensions {
    width: unit = 4u;
    height: unit = 4u;
    depth: unit = 4u;
    size: vec3<unit> = (Dimensions.width, Dimensions.height, Dimensions.depth);
    ground: vec3<unit> = (0u, 0u, 0u);
    origin: vec3<unit> = box_origin(Dimensions.ground, Dimensions.size, (0.5ratio, 0ratio, 0.5ratio));
    chartWidth: texel = texels(Dimensions.width * 2 + Dimensions.depth * 2, 1);
    chartHeight: texel = texels(Dimensions.height + Dimensions.depth, 1);
    atlasWidth: texel = 64px;
    atlasHeight: texel = 32px;
    chartOrigin: vec2<texel> = (0px, 0px);
    check eyeSpace = Dimensions.width >= 4u;
    check fitsAtlasWidth = Dimensions.chartWidth <= Dimensions.atlasWidth;
    check fitsAtlasHeight = Dimensions.chartHeight <= Dimensions.atlasHeight;
  }
  export rig contract HeadRig {
    handedness = right;
    frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
    joint root {
      parent = none; role = root;
      frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
      channels = (rotation, scale); mirror = none;
    }
  }
  export skeleton HeadSkeleton implements HeadRig {
    bind root {
      origin = Dimensions.ground;
      frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
    }
  }
  export surface contract Fur {
    atlas { width = Dimensions.atlasWidth; height = Dimensions.atlasHeight; }
    chart head box { width = Dimensions.chartWidth; height = Dimensions.chartHeight; coverage = opaque; }
    material = opaque;
  }
  export surface red_fur: Fur {
    material = opaque;
    texture atlas {
      atlas = (Dimensions.atlasWidth, Dimensions.atlasHeight);
      background = dark; background-alpha = 255;
      palette { dark = #140b0a; coat = (#5a1c10, #b94722, #ef8040); eye = #090707; }
      stamp eye { pixels = "e"; e = eye; }
      chart head box {
        origin = Dimensions.chartOrigin; fill = coat;
        face north {
          stamp eye { anchor = top_left; offset = (1px, 1px); }
          stamp eye { anchor = top_right; offset = (-1px, 1px); }
        }
      }
      grain clustered { seed = 8923; }
      tone voxel;
    }
  }
  export component Head {
    requires rig skeleton: HeadRig;
    requires surface skin: Fur;
    bind bone root to skeleton.root;
    geometry {
      bone root {
        cube head {
          origin = Dimensions.origin;
          size = Dimensions.size;
          surface = skin.head;
        }
      }
    }
  }
  export motion idle for HeadRig {
    duration = 2s; fps = 20; loop = loop; rest-relative = true;
    track root.rotation {
      key 0s = (0deg, 0deg, 0deg) linear;
      key 1s = (0deg, 3deg, 0deg) linear;
      key 2s = (0deg, 0deg, 0deg) linear;
    }
  }
  export asset study {
    settings { density = 16; forward = north; }
    skeleton = HeadSkeleton;
    motion = idle;
    use Head as head { bind skeleton = HeadRig; bind skin = red_fur; };
  }
}
```

## Fixed-size marks and protected detail

A stamp uses either `at = (xpx, ypx)` or an `anchor` and explicit signed
`offset`. Anchors are `top_left`, `top`, `top_right`, `left`, `center`, `right`,
`bottom_left`, `bottom`, and `bottom_right`. They align the complete stamp
rectangle within the face. Positive offset moves right/down in that face's
pixel coordinates; negative offset moves left/up. The engine never scales a
stamp. A centered stamp with an odd remaining pixel count fails off-grid,
rather than picking a rounding direction. Pick a corner anchor or change the
authored dimensions to resolve it.

`anchor` only positions the stamp rectangle. `flip = x` reflects its pixel
contents horizontally inside that rectangle; `y` reflects vertically, `xy`
reflects both, and omitted or `none` keeps the original. Placement, dimensions,
transparent cells, and the protection rectangle keep their original bounds.

For example, an 8-pixel-deep head with an asymmetric 3×3 eye can use:

```text
stamp eye { pixels = "eee/egg/eee"; e = outline; g = iris; }
chart head box {
  origin = (0px, 0px); fill = coat;
  face west { stamp eye { anchor = top_left; offset = (1px, 2px); } }
  face east { stamp eye { anchor = top_right; offset = (-1px, 2px); flip = x; } }
}
```

This is a placement fragment: declare its palette and matching chart as in the
complete example above. Opposite faces have opposite local horizontal
orientation. Mirrored anchors align the rectangles; reflecting the asymmetric
contents aligns the iris. Check both rendered sides. Do not impose reflection
on deliberately different marks such as scars or a wink.

Optional `protect = 1px` freezes the stamp rectangle (including transparent
dot cells) and its surrounding margin against later voxel tone and grain.
The complete protected rectangle must fit the face. Protection does not paint
alpha, override chart coverage, reserve exclusive space, or stop a later
explicit stamp from painting over it. Without `protect`, existing stamp pixel
protection and raster behavior remain unchanged.

Large color regions belong to surfaces; eyes and crests belong to deliberate
stamps; grain supplies bounded within-ramp variation. Keep silhouette, actual
depth, and attachments in geometry. Do not add coplanar geometry for paint
marks or build staircase approximations of smooth curves.

Atlas translation must preserve each face's local pixel result. Resizing a
chart may change procedural grain near boundaries; identical seeds alone do
not guarantee every previous pixel survives a size change. Review resized
faces at nearest-neighbor detail and native gameplay scale.

## Agent observation and refinement

Fetch the current runtime manifest, inspect the workspace/build identity, and
discover nodes through the guarded node inventory. Measurements and surface
inspection require `expectedRevision`, `expectedWorkspaceHash`, and
`expectedBuildKey` from that same current build. A stale guard rejects the read.

```javascript
window.ashfox.inspect({
  kind: "nodes",
  expectedRevision, expectedWorkspaceHash, expectedBuildKey,
  offset: 0, limit: 32
});
window.ashfox.inspect({
  kind: "measurement",
  expectedRevision, expectedWorkspaceHash, expectedBuildKey,
  nodeId, scope: "subtree", groundY: 0, tolerance: 0.001
});
window.ashfox.inspect({
  kind: "surface",
  expectedRevision, expectedWorkspaceHash, expectedBuildKey,
  nodeId
});
```

Measurements report rest-pose model-space axis-aligned bounds, dimensions, and signed
gap to an infinite horizontal ground plane. The envelope includes entire
primitives, including hidden geometry and alpha-cutout areas. It is not a
visible silhouette, exact occupied volume, pairwise collision test, or proof
of clearance throughout motion. Surface evidence reports per-face UV,
rotation, pixel span, texture size, sampling, and content identity.

Use the results to change the owning design field or surface recipe, preview
one complete candidate, and submit `workspace.apply`. Inspect the new build
again and complete its independent rendered reviews. The only asset write
remains the atomic workspace change; inspection never mutates canonical data.

## Hard cut and visual baseline

The source header stays `ashfox-model 1`, but the compiler fingerprint changes
for the design/anchored-pixel pipeline. Prior compiler locks are rejected; no
compatibility reader or hidden migration runs when opening a workspace.
Checked-in examples use the current lock.

The fox and goblin canonical product hashes from baseline commit `6d72df1`
are pinned by regression tests. They cover geometry, textures, and animation,
so adding precision authoring cannot silently change the established products.
New variants still require rendered judgment: passing dimensions and pixel
bounds does not certify their proportions, expression, or style.
