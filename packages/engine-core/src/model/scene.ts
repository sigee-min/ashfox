import type { AssetId, EntityId, UvRect, Vec2, Vec3 } from './identity';
import { canonicalRotatePoint } from './transform';

export interface Transform {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  pivot: Vec3;
}

export interface NodeBase {
  id: EntityId;
  name: string;
  parentId: EntityId | null;
  transform: Transform;
  visible: boolean;
  tags?: readonly string[];
}

export interface BoneNode extends NodeBase {
  kind: 'bone';
  /** Compiler-owned signed frame used to validate every target exporter. */
  canonicalFrame?: Readonly<{
    readonly origin: Vec3;
    readonly xAxis: Vec3;
    readonly yAxis: Vec3;
    readonly zAxis: Vec3;
    readonly determinant: -1 | 1;
    readonly rotation: Vec3;
  }>;
}

type CanonicalBoneFrame = NonNullable<BoneNode['canonicalFrame']>;
const sealedCanonicalFrames = new WeakMap<object, CanonicalBoneFrame>();

/** Seal an authored frame snapshot so a later structural clone or axis edit
 * cannot become a second transform authority. */
export const sealCanonicalBoneFrame = (bone: BoneNode): void => {
  if (bone.canonicalFrame === undefined) return;
  const frame = bone.canonicalFrame;
  sealedCanonicalFrames.set(
    bone,
    Object.freeze({
      origin: Object.freeze([...frame.origin]) as Vec3,
      xAxis: Object.freeze([...frame.xAxis]) as Vec3,
      yAxis: Object.freeze([...frame.yAxis]) as Vec3,
      zAxis: Object.freeze([...frame.zAxis]) as Vec3,
      determinant: frame.determinant,
      rotation: Object.freeze([...frame.rotation]) as Vec3,
    }),
  );
};

const crossAxis = (left: readonly number[], right: readonly number[]): [number, number, number] => [
  left[1]! * right[2]! - left[2]! * right[1]!,
  left[2]! * right[0]! - left[0]! * right[2]!,
  left[0]! * right[1]! - left[1]! * right[0]!,
];

const signedAxis = (value: readonly number[]): boolean =>
  value.length === 3 &&
  value.every((entry) => entry === -1 || entry === 0 || entry === 1) &&
  value.filter((entry) => entry !== 0).length === 1;

/** All target exporters use this as a fail-closed frame contract. */
export const isCanonicalBoneFrame = (
  frame: BoneNode['canonicalFrame'],
): frame is NonNullable<BoneNode['canonicalFrame']> =>
  frame !== undefined &&
  signedAxis(frame.xAxis) &&
  signedAxis(frame.yAxis) &&
  signedAxis(frame.zAxis) &&
  crossAxis(frame.xAxis, frame.yAxis).every(
    (value, index) =>
      value === (frame.determinant === 1 ? frame.zAxis[index] : -frame.zAxis[index]!),
  ) &&
  (frame.determinant === 1 || frame.determinant === -1);

export const boneTransformMatchesCanonicalFrame = (bone: BoneNode): boolean => {
  const frame = bone.canonicalFrame;
  const sealed = sealedCanonicalFrames.get(bone);
  if (frame === undefined || sealed === undefined || !isCanonicalBoneFrame(frame)) return false;
  const sameFrame = (left: CanonicalBoneFrame, right: CanonicalBoneFrame) =>
    left.determinant === right.determinant &&
    [left.origin, left.xAxis, left.yAxis, left.zAxis, left.rotation].every((axis, axisIndex) =>
      axis.every(
        (value, index) =>
          value ===
          [right.origin, right.xAxis, right.yAxis, right.zAxis, right.rotation][axisIndex]![index],
      ),
    );
  return (
    sameFrame(frame, sealed) &&
    frame.origin.every((value, index) => value === bone.transform.pivot[index]) &&
    frame.rotation.every((value, index) => value === bone.transform.rotation[index])
  );
};

export interface LocatorNode extends NodeBase {
  kind: 'locator';
  ignoreInheritedScale?: boolean;
}

export const CUBE_FACE_DIRECTIONS = ['north', 'south', 'east', 'west', 'up', 'down'] as const;

export type CubeFaceDirection = (typeof CUBE_FACE_DIRECTIONS)[number];
export type CubeFaceRotation = 0 | 90 | 180 | 270;

export interface CubeFace {
  enabled: boolean;
  textureId: AssetId | null;
  uv?: UvRect;
  rotation?: CubeFaceRotation;
  cullFace?: CubeFaceDirection;
  tintIndex?: number;
  materialInstance?: string;
}

export type CubeFaces = {
  readonly [TDirection in CubeFaceDirection]: CubeFace;
};

export const PLANE_FACE_DIRECTIONS = ['front', 'back'] as const;
export type PlaneFaceDirection = (typeof PLANE_FACE_DIRECTIONS)[number];
export type PlaneFaces = {
  readonly [TDirection in PlaneFaceDirection]: CubeFace;
};

interface CubeNodeBase extends NodeBase {
  kind: 'cube';
  inflate: number;
  mirror: boolean;
  boxUv: boolean;
  uvOffset?: Vec2;
  rescale?: boolean;
  shade?: boolean;
  lightEmission?: number;
  faces: CubeFaces;
}

/** The scene has one closed geometry authority per cube.  Axis boxes own
 * bounds; oriented boxes own their unrotated box plus the exact compiler
 * rotation.  A node can never carry both representations. */
export interface AxisCubeNode extends CubeNodeBase {
  geometryMode: 'axis-box';
  bounds: {
    from: Vec3;
    to: Vec3;
  };
  orientedBox?: never;
}

export interface OrientedCubeNode extends CubeNodeBase {
  geometryMode: 'oriented-box';
  bounds?: never;
  orientedBox: Readonly<{
    unrotatedFrom: Vec3;
    unrotatedTo: Vec3;
    pivot: Vec3;
    rotation: Readonly<{
      axis: 'x' | 'y' | 'z';
      angle22_5Units: -2 | -1 | 1 | 2;
    }>;
    cornerDenominator: number;
    cornerNumerators: readonly (readonly [string, string, string])[];
    cornerDigest: string;
    faceChartDigest: string;
    coverProofDigest: string;
  }>;
}

export type CubeNode = AxisCubeNode | OrientedCubeNode;

export const cubeUnrotatedBounds = (
  cube: CubeNode,
): Readonly<{
  from: Vec3;
  to: Vec3;
}> =>
  cube.geometryMode === 'axis-box'
    ? cube.bounds
    : Object.freeze({ from: cube.orientedBox.unrotatedFrom, to: cube.orientedBox.unrotatedTo });

export const cubeGeometryPivot = (cube: CubeNode): Vec3 =>
  cube.geometryMode === 'axis-box' ? cube.transform.pivot : cube.orientedBox.pivot;

export const cubeGeometryRotation = (cube: CubeNode): Vec3 => {
  if (cube.geometryMode === 'axis-box') return cube.transform.rotation;
  const degrees = cube.orientedBox.rotation.angle22_5Units * 22.5;
  return cube.orientedBox.rotation.axis === 'x'
    ? [degrees, 0, 0]
    : cube.orientedBox.rotation.axis === 'y'
      ? [0, degrees, 0]
      : [0, 0, degrees];
};

/** Eight exact scene-space corners under the cube's sole geometry mode.  Bone
 * hierarchy is intentionally excluded; callers that need model space compose
 * the parent chain separately. */
export const cubeGeometryCorners = (cube: CubeNode): readonly Vec3[] => {
  const bounds = cubeUnrotatedBounds(cube);
  const pivot = cubeGeometryPivot(cube);
  const rotation = cubeGeometryRotation(cube);
  const corners: Vec3[] = [];
  for (const x of [bounds.from[0], bounds.to[0]]) {
    for (const y of [bounds.from[1], bounds.to[1]]) {
      for (const z of [bounds.from[2], bounds.to[2]]) {
        const rotated = canonicalRotatePoint([x - pivot[0], y - pivot[1], z - pivot[2]], rotation);
        corners.push([
          rotated[0] + pivot[0] + cube.transform.position[0],
          rotated[1] + pivot[1] + cube.transform.position[1],
          rotated[2] + pivot[2] + cube.transform.position[2],
        ]);
      }
    }
  }
  return Object.freeze(corners);
};

/** Scene projection of one canonical charted plane. */
export interface PlaneNode extends NodeBase {
  kind: 'plane';
  /** Primitive-local width and height before the node transform. */
  size: Vec2;
  /** Canonical signed face chart.  When present, exporters must use these
   * axes instead of reconstructing an orientation from an Euler guess. */
  basis?: Readonly<{
    normal: Vec3;
    uAxis: Vec3;
    vAxis: Vec3;
    orientation: 'normal' | 'mirror-u' | 'mirror-v' | 'rotate-90';
  }>;
  sidedness: 'front' | 'double';
  /** Source-owned chart key used for plane coverage/export lineage.  Binary
   * alpha coverage remains an optional texture-raster detail. */
  coverageId: string;
  faces: PlaneFaces;
}

export type SceneNode = BoneNode | CubeNode | PlaneNode | LocatorNode;

export interface SceneGraph {
  roots: readonly EntityId[];
  nodes: Readonly<Record<EntityId, SceneNode>>;
}

export const IDENTITY_TRANSFORM: Transform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  pivot: [0, 0, 0],
};
