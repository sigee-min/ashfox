# Dimensions and pixel detail

Use shared dimensions to resize a model without losing its proportions.
Anchor small texture marks, such as eyes, so they keep their pixel size while
the surrounding shape changes. This guide includes a complete head study you
can ask your agent to build and modify.

## Share dimensions

Declare `design` inside a module or asset source unit. Fields have explicit
types and one expression each. Use `Design.field` locally or
`alias.Design.field` for an exported design in an explicitly imported module.
Vector fields also support `.x`, `.y`, and `.z` where that axis exists.

Forward references are allowed. Cycles, duplicate names, namespace shadowing,
missing fields, private imports, and unit mismatches are rejected. A named
`check` requires a boolean expression and rejects the candidate when false.
Checks describe authored relationships; they do not measure the rendered model
or move geometry to make a condition true.

Name frequently used positions with `vec3<unit>` fields. These values help place
parts consistently; they do not create joints or attach parts by themselves.

| Expression | What it does |
| --- | --- |
| `texels(length, density)` | Nonnegative `unit` length, positive `integer` pixels per unit; the result must be an integral `texel` value. No rounding. |
| `mirror_x(point, plane)` | Reflect a `vec3<unit>` point about an explicit X plane coordinate in `unit`. Y and Z variants are also available. This does not mirror geometry, frames, or UVs. |
| `box_origin(anchor, size, alignment)` | Return `anchor - size * alignment` componentwise. Size is positive `vec3<unit>`; alignment is `vec3<ratio>` with each component in `[0,1]`. |

Keep arithmetic exact. A half-unit origin can be valid while a fractional
chart dimension is not. Geometry, skeleton origins, chart dimensions, and
surface recipe values can consume the same design. The resulting surface
must still match the chart declared by its surface contract. Atlas placement is explicit: declare complete
`vec2<texel>` design fields for calculated chart origins.

## Resize a head without enlarging its eyes

Ask your agent to create a workspace entry using this complete source. Change `width` from `4u` to
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
      parent-origin = Dimensions.ground;
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

## Check a resized model

Compare the original and resized model from the front and both sides. Look at
it at gameplay size, then inspect the eye marks closely. Confirm that the eyes
keep their intended pixel size, the spacing follows the wider head, and no
texture stretches or unexpected gaps appear.

A useful refinement request is: “Make the head wider, keep both eyes the same
pixel size, and preserve the expression.” Review motion again after changing
parts near a joint.

Agents can use the measurements and surface inspection requests in the
[API workflow](agent-workflow.md) to check dimensions. Measurements describe
the resting geometry; watching the rendered model is still necessary to judge
its appearance and moving attachments.
