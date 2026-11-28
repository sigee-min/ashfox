# Animate a model

Tell your agent what the movement should communicate: “Add a curious look
around, a slow wing stretch, and a quick greeting. Keep the feet planted.”
Ask for named clips so you can choose each movement independently.

Use `check` to find clip names, and declare `preview` blocks (`clip = "NAME"; time = SECONDS;`
for still poses or `kind = gif; clip = "NAME";` for full cycles) rendered with `render --view <name>`.
For example:

```sh
npx --no-install ashfox render fox.ashfox --view tail_wag --output tail-wag.gif
```

![Fox tail-wag clip](/media/guides/fox-motion.gif)

The sections below explain the source your agent writes. A **snippet** belongs
inside an existing source file; the complete starting example is linked at the
end of this guide.

## Place the joints first

Skeleton binds use **`parent_origin` in the parent joint frame**. A root joint
uses model coordinates. For an unrotated torso at `(0u, 13u, 0u)`, a shoulder
at model `(6.5u, 19.5u, 0u)` needs `parent_origin = (6.5u, 6.5u, 0u)`.
The parent rotates or reflects this offset together with its children.
The legacy skeleton property `origin` is rejected instead of being guessed.
Keep the weapon beneath the hand's joint in the rig hierarchy and put its
origin at the grip. Preview the whole motion to check the direction of each
rotation, the hand contact, and planted feet.

## Create a motion

Declare a motion for the rig contract whose joints it animates. The rig must
allow every channel you use (`position`, `rotation`, and `scale`), and can
declare optional `limits`, `chain`, `ik_limb`, and `anchor` metadata.

**Snippet — one motion declaration:**

```text
export motion idle for CreatureRig {
  duration = 2s;
  fps = 20;
  loop = loop;
  track head.rotation {
    key 0s = (0deg, 0deg, 0deg) linear;
    key 1s = (0deg, 3deg, 0deg) linear;
    key 2s = (0deg, 0deg, 0deg) linear;
  }
}
```

`duration` must be positive. `fps` is an integer from `1` through `240`.
Reusable rig motions are rest-space relative by default (`rest_relative = true`). Key times must be
inside the duration and strictly increasing.

### Position, rotation, and scale tracks

Track targets address `<joint>.position`, `<joint>.rotation`, or `<joint>.scale`.

**Snippet — rotation and scale:**

```text
track wing_left.rotation {
  key 0s = (0deg, 0deg, 0deg) catmullrom;
  key 0.8s = (0deg, 0deg, -18deg) catmullrom;
  key 1.6s = (0deg, 0deg, 0deg) catmullrom;
}

track root.scale {
  key 0s = (1, 1, 1) step;
  key 0.8s = (1.1, 1, 1) linear;
  key 1.6s = (1, 1, 1) linear;
}
```

Rotation values are three degree values (`vec3<degree>`), `position` values are
model-space offsets (`vec3<unit>`), and `scale` values are three positive ratio
values (`vec3<ratio>`). The target joint must declare the matching channel in
its `channels` list.

Each key must name its interpolation (`linear`, `step`, `smooth`, `ease_in`,
`ease_out`, `ease_in_out`, `cubic`, `snap`, `anticipate`, `overshoot`,
`bounce`, `elastic`, or `catmullrom`), with optional curve parameters (for
example `smooth(...)` or `overshoot(strength = 1.4)`). The interpolation curve
belongs after the value, before the semicolon; rotation channels bake with
quaternion-native SLERP interpolation.

#### Rotation sign convention (right-handed, `forward = north (-Z)`)

Ashfox uses a right-handed coordinate frame with **`+X` right**, **`+Y` up**,
and **`-Z` north (front)** (`+Z` back). Point your right thumb along the
positive axis to find positive rotation direction:

- **`+X` rotation (thumb right)**: pitches `-Z` forward parts **upward (`+Y`)**,
  hanging `-Y` limbs (arms/legs) **forward (`-Z`)**, and upward `+Y` torso/neck
  **backward (`+Z`)**.
- **`-X` rotation**: pitches upward `+Y` torso/neck **forward (`-Z`, hunch/lunge)**,
  `-Z` forward parts **downward (`-Y`)**, and hanging `-Y` limbs **backward (`+Z`)**.
- **`+Y` / `-Y` yaw (thumb up)**: `+Y` turns `-Z` forward parts left
  (counter-clockwise from above); `-Y` turns right.
- **`+Z` / `-Z` roll (thumb back)**: `+Z` tilts `+X` toward `+Y` (rolls left /
  lifts the `+X` side); `-Z` tilts `-X` toward `+Y` (rolls right / lifts the `-X` side).

Mirroring is explicit opt-in via `mirror = antiphase;` or `mirror = sync;`
(`mirrorMode`) on a `layer` block—omitting it keeps single-limb tracks
independent without auto-mirroring opposite limbs. Continuous multi-turn spins
(`360deg` / `720deg`) interpolate cleanly along the declared Euler winding.

## Procedural waves, IK, secondary physics, combat, and cues

Motions also compose higher-level animation blocks directly inside `motion`:

```text
export motion stride for CreatureRig {
  duration = 0.8s;
  fps = 30;
  loop = loop;
  wave torso.position.y { amp = 0.6u; freq = 2; shape = cos; }
  ik foot_lock leg_l { ground_y = 0u; lock_phase = 0.1..0.5; step_height = 2.5u; }
  secondary chain tail { stiffness = 140; damping = 0.25; gravity = -12; }
  cue sound at 0.25s = "footstep";
}
```

Use `layer` blocks (`mode = override | additive;`, `weight`, `mask = [...]`),
named `pose` / `at <t> pose <name>` keys, facial `expression <slot> { at 0.00s = neutral; at 1.45s..1.58s = blink; }` swaps (backed by `expression_slot` in geometry, zero extra draw calls), combat timing ops (`squash`, `smear`,
`hitstop`, `recoil`), and timeline `cue` events (`sound`, `vfx`, `event`) baked
into `gltf.animations[i].extras.ashfoxCues`.

## Set loop and duration behavior

Choose one of the three accepted loop values:

| Source value | Playback behavior |
| --- | --- |
| `once` | play through the duration and stop |
| `loop` | wrap back to the beginning and repeat |
| `hold_on_last_frame` | play through the duration and hold the final pose |

Keep the first and last keys intentional: for a looping idle, matching the opening and
closing pose makes the wrap look continuous.

## Assign and select motions

Declare a motion in a reusable module when several assets share it, then import
that module with an alias. Assign each motion explicitly in the asset
assembly.

**Snippet — import and assign more than one motion:**

```text
model griffin {
  import "./animation.ashfox" as animation;
  settings { density = 16; forward = north; }
  skeleton = animation.GriffinSkeleton;
  motions = [
    animation.idle,
    animation.look_around,
    animation.wing_display,
    animation.wing_flap,
    animation.greeting,
    animation.alert,
  ];
  // component uses and surface bindings continue here
}
```

The asset can select multiple different motions, but a motion may be assigned
only once and every assigned motion must target the selected skeleton's rig.
The component's rig port must bind to that same rig contract too.

Use `check` to find clip names and durations, then declare `preview` blocks (`kind = gif; clip = "NAME";`
or `clip = "NAME"; time = SECONDS;`) and pass `--view <name>` to `render`.

## Griffin's six clips

The checked Griffin example exports these six motion names from its
`animation` module. They are ordinary source declarations, so copy the names
with the module alias when assigning them:

| Clip | Movement | Duration |
| --- | --- | ---: |
| `idle` | Gentle resting movement | `3s` |
| `look_around` | Turn the head to inspect both sides | `4s` |
| `wing_display` | Raise the wings and hold the pose | `3.6s` |
| `wing_flap` | Quick paired wing beats | `1.6s` |
| `greeting` | Nod the head and wag the tail | `3s` |
| `alert` | React and turn toward a disturbance | `2.4s` |

Inspect `showcase/assets/models/griffin_boss.ashfox`, `showcase/assets/models/goblin_raider.ashfox`,
and the built-in standard-library modules (`ashfox library std list model/rig` and `ashfox library std list model/motion`).
Download [the game project](/downloads/game-assets.zip) for a complete multi-asset bundle.

All six are rest-space relative. Their track targets are the Griffin rig's semantic
joints, including `head`, `wing_left`, `wing_right`, and `tail`.

## Review every motion

After a source change, select each assigned clip and watch one complete cycle.
Check the opening and closing pose, the largest movement, and the motion at
native gameplay scale. Inspect both sides of the asset so mirrored parts stay
attached, and scrub the timeline to catch keys that create a sudden jump.

For a scale track, check that the part stays visible and that all three scale
components remain positive. For rotation, check pivots and attachments at the
largest angle. If the source validates but the motion looks wrong, describe
the visible problem and revise the owning track, joint binding, or rest pose;
validation alone does not certify the animation's visual quality.

## Complete source

The [complete source in the language reference](../language/model.md)
is a small animated cube with a rig, skeleton, surface, component, motion, and
asset assembly. Use it when you need a standalone starting file. The snippets
on this page are motion fragments and intentionally omit the surrounding
surface and component declarations.
