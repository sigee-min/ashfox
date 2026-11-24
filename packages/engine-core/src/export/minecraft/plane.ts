import { canonicalMinecraftRotation } from '../../model';
import type { CubeFace, PlaneFaceDirection, PlaneNode, Vec2, Vec3 } from '../../model';

export interface MinecraftPlaneLowering {
  readonly origin: [number, number, number];
  readonly size: [number, number, number];
  readonly pivot?: [number, number, number];
  readonly rotation?: [number, number, number];
}

const negate = (value: number): number => (Math.abs(value) <= 0.000001 ? 0 : -value);

const vectorKey = (value: readonly number[]): string =>
  value.map((entry) => (Object.is(entry, -0) ? 0 : entry)).join(',');

const rotateTextureCorners = (
  corners: readonly [Vec2, Vec2, Vec2, Vec2],
  rotation: 0 | 90 | 180 | 270,
): readonly [Vec2, Vec2, Vec2, Vec2] => {
  const steps = rotation / 90;
  return [
    corners[steps % 4]!,
    corners[(1 + steps) % 4]!,
    corners[(2 + steps) % 4]!,
    corners[(3 + steps) % 4]!,
  ];
};

export interface CanonicalPlaneUvTransform {
  readonly uv: [number, number];
  readonly uvSize: [number, number];
  readonly rotation: 0 | 90 | 180 | 270;
  readonly mirrorU: boolean;
  readonly mirrorV: boolean;
}

/** Shared rectangle-level lowering consumed by Bedrock and the glTF corner
 * projector.  No target may reinterpret a plane basis independently. */
export const canonicalPlaneTextureUvTransform = (
  plane: PlaneNode,
  face: CubeFace,
): CanonicalPlaneUvTransform | undefined => {
  if (!face.enabled || face.uv === undefined) return undefined;
  const width = face.uv[2] - face.uv[0];
  const height = face.uv[3] - face.uv[1];
  const orientation = plane.basis?.orientation;
  const rotation = (((face.rotation ?? 0) + (orientation === 'rotate-90' ? 90 : 0)) % 360) as
    0 | 90 | 180 | 270;
  return Object.freeze({
    uv: [face.uv[0], face.uv[1]] as [number, number],
    uvSize: [width, height] as [number, number],
    rotation,
    mirrorU: orientation === 'mirror-u',
    mirrorV: orientation === 'mirror-v',
  });
};

/** One canonical pixel-corner chart for every plane exporter. */
export const canonicalPlaneTextureUvCorners = (
  plane: PlaneNode,
  face: CubeFace,
  direction: PlaneFaceDirection,
): readonly [Vec2, Vec2, Vec2, Vec2] | undefined => {
  if (!face.enabled || face.uv === undefined) return undefined;
  const transform = canonicalPlaneTextureUvTransform(plane, face);
  if (transform === undefined) return undefined;
  const minimumU = transform.uv[0];
  const minimumV = transform.uv[1];
  const maximumU = minimumU + transform.uvSize[0];
  const maximumV = minimumV + transform.uvSize[1];
  const base: readonly [Vec2, Vec2, Vec2, Vec2] = [
    [minimumU, maximumV],
    [maximumU, maximumV],
    [maximumU, minimumV],
    [minimumU, minimumV],
  ];
  let corners = direction === 'front' ? base : ([base[1]!, base[0]!, base[3]!, base[2]!] as const);
  if (transform.mirrorU) {
    corners = [
      [minimumU + maximumU - corners[0]![0], corners[0]![1]],
      [minimumU + maximumU - corners[1]![0], corners[1]![1]],
      [minimumU + maximumU - corners[2]![0], corners[2]![1]],
      [minimumU + maximumU - corners[3]![0], corners[3]![1]],
    ];
  } else if (transform.mirrorV) {
    corners = [
      [corners[0]![0], minimumV + maximumV - corners[0]![1]],
      [corners[1]![0], minimumV + maximumV - corners[1]![1]],
      [corners[2]![0], minimumV + maximumV - corners[2]![1]],
      [corners[3]![0], minimumV + maximumV - corners[3]![1]],
    ];
  }
  return rotateTextureCorners(corners, transform.rotation);
};

const cross = (left: readonly number[], right: readonly number[]): [number, number, number] => [
  left[1]! * right[2]! - left[2]! * right[1]!,
  left[2]! * right[0]! - left[0]! * right[2]!,
  left[0]! * right[1]! - left[1]! * right[0]!,
];

/** Closed Bedrock lowering for every signed right-handed Minecraft plane
 * frame.  The table is deliberately exhaustive: geometry orientation must
 * never be inferred from a UV transform or from the first matching axis. */
export const canonicalPlaneRotation = (plane: PlaneNode): [number, number, number] => {
  if (plane.basis === undefined) return [...plane.transform.rotation];
  const { normal, uAxis, vAxis } = plane.basis;
  const validAxis = (axis: readonly number[]): boolean =>
    axis.length === 3 &&
    axis.filter((value) => value !== 0).length === 1 &&
    axis.every((value) => value === -1 || value === 0 || value === 1);
  if (
    !validAxis(normal) ||
    !validAxis(uAxis) ||
    !validAxis(vAxis) ||
    vectorKey(cross(uAxis, vAxis)) !== vectorKey(normal)
  ) {
    throw new RangeError('Plane basis must be a signed right-handed axis frame.');
  }
  const key = `${vectorKey(normal)}|${vectorKey(uAxis)}|${vectorKey(vAxis)}`;
  const rotations: Readonly<Record<string, [number, number, number]>> = {
    '1,0,0|0,1,0|0,0,1': [90, 0, 90],
    '1,0,0|0,-1,0|0,0,-1': [90, 180, 90],
    '1,0,0|0,0,1|0,-1,0': [0, -90, 180],
    '1,0,0|0,0,-1|0,1,0': [0, 90, 0],
    '-1,0,0|0,1,0|0,0,-1': [90, 180, -90],
    '-1,0,0|0,-1,0|0,0,1': [90, 0, -90],
    '-1,0,0|0,0,1|0,1,0': [0, -90, 0],
    '-1,0,0|0,0,-1|0,-1,0': [0, 90, 180],
    '0,1,0|1,0,0|0,0,-1': [-90, 0, 180],
    '0,1,0|-1,0,0|0,0,1': [90, 0, 0],
    '0,1,0|0,0,1|1,0,0': [0, -90, 90],
    '0,1,0|0,0,-1|-1,0,0': [0, 90, -90],
    '0,-1,0|1,0,0|0,0,1': [90, 0, 180],
    '0,-1,0|-1,0,0|0,0,-1': [90, 180, 180],
    '0,-1,0|0,0,1|-1,0,0': [0, -90, -90],
    '0,-1,0|0,0,-1|1,0,0': [0, 90, 90],
    '0,0,1|1,0,0|0,1,0': [0, 180, 0],
    '0,0,1|-1,0,0|0,-1,0': [0, 180, 180],
    '0,0,1|0,1,0|-1,0,0': [0, 180, -90],
    '0,0,1|0,-1,0|1,0,0': [0, 180, 90],
    '0,0,-1|1,0,0|0,-1,0': [0, 0, 180],
    '0,0,-1|-1,0,0|0,1,0': [0, 0, 0],
    '0,0,-1|0,1,0|1,0,0': [0, 0, 90],
    '0,0,-1|0,-1,0|-1,0,0': [0, 0, -90],
  };
  const rotation = rotations[key];
  if (rotation === undefined)
    throw new RangeError(`Plane basis ${key} has no deterministic Bedrock lowering.`);
  return [...rotation];
};

const addScaled = (
  origin: readonly [number, number, number],
  axis: readonly [number, number, number],
  amount: number,
): [number, number, number] => [
  origin[0] + axis[0] * amount,
  origin[1] + axis[1] * amount,
  origin[2] + axis[2] * amount,
];

/** Lower a canonical chart to one Bedrock zero-depth element. */
export const lowerCanonicalPlane = (plane: PlaneNode): MinecraftPlaneLowering => {
  if (plane.basis === undefined) {
    const from = plane.transform.position;
    const to: Vec3 = [from[0] + plane.size[0], from[1] + plane.size[1], from[2]];
    const rotation = plane.transform.rotation;
    const hasRotation = rotation.some((value) => Math.abs(value) > 0.000001);
    return Object.freeze({
      origin: [negate(to[0]), from[1], from[2]] as [number, number, number],
      size: [plane.size[0], plane.size[1], 0] as [number, number, number],
      ...(hasRotation
        ? {
            pivot: [
              negate(plane.transform.pivot[0] + plane.transform.position[0]),
              plane.transform.pivot[1] + plane.transform.position[1],
              plane.transform.pivot[2] + plane.transform.position[2],
            ] as [number, number, number],
            rotation: canonicalMinecraftRotation(rotation),
          }
        : {}),
    });
  }
  const { basis } = plane;
  const chartOrigin = addScaled(
    addScaled(
      addScaled(plane.transform.position, basis.uAxis, -plane.transform.pivot[0]),
      basis.vAxis,
      -plane.transform.pivot[1],
    ),
    basis.normal,
    -plane.transform.pivot[2],
  );
  const origin: [number, number, number] = [negate(chartOrigin[0]), chartOrigin[1], chartOrigin[2]];
  const rotation = canonicalPlaneRotation(plane);
  const hasRotation = rotation.some((value) => Math.abs(value) > 0.000001);
  return Object.freeze({
    origin,
    size: [plane.size[0], plane.size[1], 0] as [number, number, number],
    ...(hasRotation ? { pivot: origin, rotation } : {}),
  });
};
