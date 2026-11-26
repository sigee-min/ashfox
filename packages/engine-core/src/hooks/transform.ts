import type { Vec3 } from '../model/identity';
import { add3, cross3, length3, normalize3, scale3 } from '../math/vec3';
import type { BlockRotation } from '../project/structure/contract';
import type {
  CompiledAnchor,
  CompiledVolume,
  CompiledVolumeObb,
  CompiledZone,
  HookBoneTransform,
  HookFacing,
  HookFloorFrame,
  HookParentRef,
  HookRoomBounds,
  HooksDocument,
  HookTransformContext,
  HookTransformStep,
} from './contract';

interface AffineTransform {
  readonly origin: Vec3;
  readonly cols: readonly [Vec3, Vec3, Vec3];
}

const v3 = (x: number, y: number, z: number): Vec3 => Object.freeze([x, y, z]);

const IDENTITY_TRANSFORM: AffineTransform = Object.freeze({
  origin: v3(0, 0, 0),
  cols: Object.freeze([v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1)] as const),
});

const FACING_NORMALS: Readonly<Record<HookFacing, Vec3>> = Object.freeze({
  north: v3(0, 0, -1),
  south: v3(0, 0, 1),
  east: v3(1, 0, 0),
  west: v3(-1, 0, 0),
  up: v3(0, 1, 0),
  down: v3(0, -1, 0),
});

const FACING_YAW: Readonly<Record<HookFacing, number>> = Object.freeze({
  south: 0,
  west: -90,
  north: 180,
  east: 90,
  up: 0,
  down: 0,
});

const cleanZero = (n: number): number => (Math.abs(n) < 1e-10 ? 0 : Math.round(n * 1e9) / 1e9);

const cleanVec3 = (v: Vec3): Vec3 =>
  Object.freeze([cleanZero(v[0]), cleanZero(v[1]), cleanZero(v[2])]);

/** Convert a cardinal/vertical facing keyword to its unit normal vector. */
export const facingToNormal = (facing: HookFacing): Vec3 => FACING_NORMALS[facing];

/** Convert a facing keyword to its default Y-axis yaw rotation in degrees. */
export const facingToYawDegrees = (facing: HookFacing): number => FACING_YAW[facing];

const mulMatVec = (cols: readonly [Vec3, Vec3, Vec3], v: Vec3): Vec3 => [
  cols[0][0] * v[0] + cols[1][0] * v[1] + cols[2][0] * v[2],
  cols[0][1] * v[0] + cols[1][1] * v[1] + cols[2][1] * v[2],
  cols[0][2] * v[0] + cols[1][2] * v[1] + cols[2][2] * v[2],
];

const composeAffine = (outer: AffineTransform, inner: AffineTransform): AffineTransform => ({
  origin: add3(outer.origin, mulMatVec(outer.cols, inner.origin)),
  cols: [
    mulMatVec(outer.cols, inner.cols[0]),
    mulMatVec(outer.cols, inner.cols[1]),
    mulMatVec(outer.cols, inner.cols[2]),
  ],
});

const rotationColsXYZ = (degrees: Vec3): readonly [Vec3, Vec3, Vec3] => {
  const rad = (d: number): number => (d * Math.PI) / 180;
  const [rx, ry, rz] = [rad(degrees[0]), rad(degrees[1]), rad(degrees[2])];
  const [cx, sx] = [Math.cos(rx), Math.sin(rx)];
  const [cy, sy] = [Math.cos(ry), Math.sin(ry)];
  const [cz, sz] = [Math.cos(rz), Math.sin(rz)];
  return [
    [cy * cz, sx * sy * cz + cx * sz, -cx * sy * cz + sx * sz],
    [-cy * sz, -sx * sy * sz + cx * cz, cx * sy * sz + sx * cz],
    [sy, -sx * cy, cx * cy],
  ];
};

const rotateStepToAffine = (
  step: Extract<HookTransformStep, { kind: 'rotate' }>,
): AffineTransform => {
  const cols = rotationColsXYZ(step.degrees);
  const pivot = step.pivot ?? [0, 0, 0];
  const origin: Vec3 = [
    pivot[0] - (cols[0][0] * pivot[0] + cols[1][0] * pivot[1] + cols[2][0] * pivot[2]),
    pivot[1] - (cols[0][1] * pivot[0] + cols[1][1] * pivot[1] + cols[2][1] * pivot[2]),
    pivot[2] - (cols[0][2] * pivot[0] + cols[1][2] * pivot[1] + cols[2][2] * pivot[2]),
  ];
  return { origin, cols };
};

const mirrorStepToAffine = (
  step: Extract<HookTransformStep, { kind: 'mirror' }>,
): AffineTransform => {
  const axisIndex = step.axis === 'x' ? 0 : step.axis === 'y' ? 1 : 2;
  const origin: [number, number, number] = [0, 0, 0];
  origin[axisIndex] = 2 * step.center;
  const scales: [number, number, number] = [1, 1, 1];
  scales[axisIndex] = -1;
  return {
    origin,
    cols: [
      [scales[0], 0, 0],
      [0, scales[1], 0],
      [0, 0, scales[2]],
    ],
  };
};

const stepToAffine = (step: HookTransformStep): AffineTransform => {
  if (step.kind === 'translate') {
    return { origin: step.offset, cols: IDENTITY_TRANSFORM.cols };
  }
  if (step.kind === 'rotate') return rotateStepToAffine(step);
  if (step.kind === 'mirror') return mirrorStepToAffine(step);
  return compoundStepToAffine(step);
};

const compoundStepToAffine = (
  step: Extract<HookTransformStep, { kind: 'compound_place' }>,
): AffineTransform => {
  const [cw, _ch, cd] = step.childSize ?? [0, 0, 0];
  const [ox, oy, oz] = step.origin;
  const rotMap: Readonly<Record<BlockRotation, AffineTransform>> = {
    0: { origin: [ox, oy, oz], cols: IDENTITY_TRANSFORM.cols },
    90: {
      origin: [ox + cd, oy, oz],
      cols: [
        [0, 0, 1],
        [0, 1, 0],
        [-1, 0, 0],
      ],
    },
    180: {
      origin: [ox + cw, oy, oz + cd],
      cols: [
        [-1, 0, 0],
        [0, 1, 0],
        [0, 0, -1],
      ],
    },
    270: {
      origin: [ox, oy, oz + cw],
      cols: [
        [0, 0, -1],
        [0, 1, 0],
        [1, 0, 0],
      ],
    },
  };
  let xform = rotMap[step.rotate];
  if (step.mirror) {
    xform = composeAffine(stepToAffine({ kind: 'mirror', ...step.mirror }), xform);
  }
  return xform;
};

const composeSteps = (steps: readonly HookTransformStep[]): AffineTransform => {
  let acc = IDENTITY_TRANSFORM;
  for (const step of steps) {
    acc = composeAffine(stepToAffine(step), acc);
  }
  return acc;
};

const resolveBoneTransform = (
  id: string,
  bones: Readonly<Record<string, HookBoneTransform>>,
  visited: Set<string>,
): AffineTransform => {
  if (visited.has(id)) return IDENTITY_TRANSFORM;
  const bone = bones[id];
  if (!bone) return IDENTITY_TRANSFORM;
  visited.add(id);
  const rotCols = bone.rotation ? rotationColsXYZ(bone.rotation) : IDENTITY_TRANSFORM.cols;
  const sc = bone.scale ?? [1, 1, 1];
  const local: AffineTransform = {
    origin: bone.translation,
    cols: [scale3(rotCols[0], sc[0]), scale3(rotCols[1], sc[1]), scale3(rotCols[2], sc[2])],
  };
  if (!bone.parentId) return local;
  const parent = resolveBoneTransform(bone.parentId, bones, visited);
  return composeAffine(parent, local);
};

const resolveRoomTransform = (
  id: string,
  context: HookTransformContext,
  visited: Set<string>,
): AffineTransform => {
  if (visited.has(`room:${id}`)) return IDENTITY_TRANSFORM;
  const room: HookRoomBounds | undefined = context.rooms?.[id];
  if (!room) return IDENTITY_TRANSFORM;
  visited.add(`room:${id}`);
  const local: AffineTransform = { origin: room.min, cols: IDENTITY_TRANSFORM.cols };
  if (!room.parentId) return local;
  const parent =
    context.floors?.[room.parentId] !== undefined
      ? resolveFloorTransform(room.parentId, context, visited)
      : resolveRoomTransform(room.parentId, context, visited);
  return composeAffine(parent, local);
};

const resolveFloorTransform = (
  id: string,
  context: HookTransformContext,
  visited: Set<string>,
): AffineTransform => {
  if (visited.has(`floor:${id}`)) return IDENTITY_TRANSFORM;
  const floor: HookFloorFrame | undefined = context.floors?.[id];
  if (!floor) return IDENTITY_TRANSFORM;
  visited.add(`floor:${id}`);
  const off = floor.offset ?? [0, 0, 0];
  const local: AffineTransform = {
    origin: [off[0], floor.y + off[1], off[2]],
    cols: IDENTITY_TRANSFORM.cols,
  };
  if (!floor.parentId) return local;
  return composeAffine(resolveFloorTransform(floor.parentId, context, visited), local);
};

const resolveParentAffine = (
  parent: HookParentRef | undefined,
  context: HookTransformContext,
): AffineTransform => {
  if (!parent || parent.kind === 'root' || parent.kind === 'surface') return IDENTITY_TRANSFORM;
  const visited = new Set<string>();
  if (parent.kind === 'bone' && context.bones) {
    return resolveBoneTransform(parent.id, context.bones, visited);
  }
  if (parent.kind === 'room') return resolveRoomTransform(parent.id, context, visited);
  if (parent.kind === 'floor') return resolveFloorTransform(parent.id, context, visited);
  if (parent.kind === 'compound' && context.compounds?.[parent.id]) {
    return composeSteps(context.compounds[parent.id]!);
  }
  return IDENTITY_TRANSFORM;
};

const buildTotalAffine = (
  parent: HookParentRef | undefined,
  context: HookTransformContext,
): AffineTransform => {
  const base = resolveParentAffine(parent, context);
  if (!context.postTransforms || context.postTransforms.length === 0) return base;
  return composeAffine(composeSteps(context.postTransforms), base);
};

const extractEulerDegrees = (cols: readonly [Vec3, Vec3, Vec3]): Vec3 => {
  const [c0, c1, c2] = cols;
  const sy = Math.max(-1, Math.min(1, c2[0]));
  const ry = Math.asin(sy);
  const cy = Math.cos(ry);
  const toDeg = (r: number): number => (r * 180) / Math.PI;
  if (Math.abs(cy) > 1e-6) {
    const rx = Math.atan2(-c2[1], c2[2]);
    const rz = Math.atan2(-c1[0], c0[0]);
    return cleanVec3([toDeg(rx), toDeg(ry), toDeg(rz)]);
  }
  const rx = Math.atan2(c1[2], c1[1]);
  return cleanVec3([toDeg(rx), toDeg(ry), 0]);
};

const transformNormal = (cols: readonly [Vec3, Vec3, Vec3], normal: Vec3): Vec3 => {
  const [c0, c1, c2] = cols;
  const cof0 = cross3(c1, c2);
  const cof1 = cross3(c2, c0);
  const cof2 = cross3(c0, c1);
  const det = c0[0] * cof0[0] + c0[1] * cof0[1] + c0[2] * cof0[2];
  const sign = det < 0 ? -1 : 1;
  const raw: Vec3 = [
    sign * (cof0[0] * normal[0] + cof1[0] * normal[1] + cof2[0] * normal[2]),
    sign * (cof0[1] * normal[0] + cof1[1] * normal[1] + cof2[1] * normal[2]),
    sign * (cof0[2] * normal[0] + cof1[2] * normal[1] + cof2[2] * normal[2]),
  ];
  return cleanVec3(normalize3(raw));
};

const transformObb = (obb: CompiledVolumeObb, xform: AffineTransform): CompiledVolumeObb => {
  const center = cleanVec3(add3(xform.origin, mulMatVec(xform.cols, obb.center)));
  const axes: [Vec3, Vec3, Vec3] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const half: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    const vec = mulMatVec(xform.cols, scale3(obb.axes[i]!, obb.halfExtents[i]!));
    const len = length3(vec);
    half[i] = cleanZero(len);
    axes[i] = len > 1e-9 ? cleanVec3(scale3(vec, 1 / len)) : obb.axes[i]!;
  }
  return Object.freeze({
    center,
    halfExtents: Object.freeze(half),
    axes: Object.freeze(axes),
    rotation: extractEulerDegrees(axes),
  });
};

const obbToAabb = (obb: CompiledVolumeObb): { readonly min: Vec3; readonly max: Vec3 } => {
  const rx =
    Math.abs(obb.axes[0][0]) * obb.halfExtents[0] +
    Math.abs(obb.axes[1][0]) * obb.halfExtents[1] +
    Math.abs(obb.axes[2][0]) * obb.halfExtents[2];
  const ry =
    Math.abs(obb.axes[0][1]) * obb.halfExtents[0] +
    Math.abs(obb.axes[1][1]) * obb.halfExtents[1] +
    Math.abs(obb.axes[2][1]) * obb.halfExtents[2];
  const rz =
    Math.abs(obb.axes[0][2]) * obb.halfExtents[0] +
    Math.abs(obb.axes[1][2]) * obb.halfExtents[1] +
    Math.abs(obb.axes[2][2]) * obb.halfExtents[2];
  return {
    min: cleanVec3([obb.center[0] - rx, obb.center[1] - ry, obb.center[2] - rz]),
    max: cleanVec3([obb.center[0] + rx, obb.center[1] + ry, obb.center[2] + rz]),
  };
};

/** Compute a local OBB from axis-aligned bounds and optional Euler rotation degrees. */
export const buildObbFromBox = (
  from: Vec3,
  to: Vec3,
  rotate: Vec3 = [0, 0, 0],
): CompiledVolumeObb => {
  const center = cleanVec3([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2]);
  const halfExtents = cleanVec3([
    Math.abs(to[0] - from[0]) / 2,
    Math.abs(to[1] - from[1]) / 2,
    Math.abs(to[2] - from[2]) / 2,
  ]);
  const cols = rotationColsXYZ(rotate);
  const axes: readonly [Vec3, Vec3, Vec3] = Object.freeze([
    cleanVec3(cols[0]),
    cleanVec3(cols[1]),
    cleanVec3(cols[2]),
  ]);
  return Object.freeze({
    center,
    halfExtents,
    axes,
    rotation: cleanVec3(rotate),
  });
};

export { obbToAabb };

/** Transform a 3D point through a sequence of hook transform steps. */
export const transformPoint = (point: Vec3, steps: readonly HookTransformStep[]): Vec3 => {
  const xform = composeSteps(steps);
  return cleanVec3(add3(xform.origin, mulMatVec(xform.cols, point)));
};

/** Transform and normalize a 3D direction vector through a sequence of hook transform steps. */
export const transformDirection = (dir: Vec3, steps: readonly HookTransformStep[]): Vec3 =>
  transformNormal(composeSteps(steps).cols, dir);

/** Propagate parent and post transforms onto a compiled anchor. */
export const transformAnchor = (
  anchor: CompiledAnchor,
  context: HookTransformContext = {},
): CompiledAnchor => {
  const xform = buildTotalAffine(anchor.parent, context);
  const localCols = rotationColsXYZ(anchor.rotation);
  const composedCols: readonly [Vec3, Vec3, Vec3] = [
    normalize3(mulMatVec(xform.cols, localCols[0])),
    normalize3(mulMatVec(xform.cols, localCols[1])),
    normalize3(mulMatVec(xform.cols, localCols[2])),
  ];
  return Object.freeze({
    ...anchor,
    position: cleanVec3(add3(xform.origin, mulMatVec(xform.cols, anchor.position))),
    normal: transformNormal(xform.cols, anchor.normal),
    rotation: extractEulerDegrees(composedCols),
  });
};

/** Propagate parent and post transforms onto a compiled volume's OBB and AABB bounds. */
export const transformVolume = (
  volume: CompiledVolume,
  context: HookTransformContext = {},
): CompiledVolume => {
  const xform = buildTotalAffine(volume.parent, context);
  const obb = transformObb(volume.obb, xform);
  const bounds = obbToAabb(obb);
  return Object.freeze({ ...volume, obb, min: bounds.min, max: bounds.max });
};

/** Propagate parent and post transforms onto a compiled zone's OBB and AABB bounds. */
export const transformZone = (
  zone: CompiledZone,
  context: HookTransformContext = {},
): CompiledZone => {
  const xform = buildTotalAffine(zone.parent, context);
  const obb = transformObb(zone.obb, xform);
  const bounds = obbToAabb(obb);
  return Object.freeze({ ...zone, obb, min: bounds.min, max: bounds.max });
};

/** Propagate deterministic parent and placement transforms across an entire compiled hooks document. */
export const propagateHooksTransforms = (
  doc: HooksDocument,
  context: HookTransformContext,
): HooksDocument =>
  Object.freeze({
    ...doc,
    anchors: Object.freeze(doc.anchors.map((a) => transformAnchor(a, context))),
    volumes: Object.freeze(doc.volumes.map((v) => transformVolume(v, context))),
    zones: Object.freeze(doc.zones.map((z) => transformZone(z, context))),
  });

/** Detect parent-chain cycles in a transform context (bones, rooms, floors). */
export const detectTransformCycles = (context: HookTransformContext): readonly string[] => {
  const cycles: string[] = [];
  const checkMap = <T extends { readonly parentId?: string }>(
    prefix: string,
    items: Readonly<Record<string, T>> | undefined,
  ): void => {
    if (!items) return;
    for (const id of Object.keys(items)) {
      const seen = new Set<string>();
      let cur: string | undefined = id;
      while (cur && items[cur]) {
        if (seen.has(cur)) {
          cycles.push(`${prefix}:${id}`);
          break;
        }
        seen.add(cur);
        cur = items[cur]!.parentId;
      }
    }
  };
  checkMap('bone', context.bones);
  checkMap('room', context.rooms);
  checkMap('floor', context.floors);
  return Object.freeze(cycles);
};
