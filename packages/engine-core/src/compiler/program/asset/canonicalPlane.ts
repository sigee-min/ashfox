import { freeze } from '../../../immutable';
import type { UvRect, Vec2, Vec3 } from '../../../model/identity';
import type { CubeFace, PlaneFaces, SceneNode } from '../../../model/scene';
import type { InstantiatedGeometryNode } from './ir';
import type { AssetTexturePlan } from './texture/contract';
import type { AssetExactNumber } from './value/contract';
import {
  INTEGER_BOUNDARY,
  NUMBER_BOUNDARY,
  exactToVector2,
  exactToVector3,
  exactVector,
  positiveIntegral,
  propertyMap,
  report,
  signedAxis,
  surfacePlan,
  transformFor,
  visibleFor,
  type Context,
  type GeometryRecord,
  type PropertyEntry,
  type SurfaceBindings,
  type SurfacePlan,
} from './geometrySupport';

const PLANE_ALLOWED = new Set([
  'origin',
  'size',
  'position',
  'rotation',
  'pivot',
  'visible',
  'u-axis',
  'v-axis',
]);

interface PlaneBasis {
  readonly normal: Vec3;
  readonly uAxis: Vec3;
  readonly vAxis: Vec3;
}

const planeBasis = (
  u: readonly AssetExactNumber[],
  v: readonly AssetExactNumber[],
  properties: ReadonlyMap<string, PropertyEntry>,
  node: InstantiatedGeometryNode,
  context: Context,
): PlaneBasis | null => {
  const uAxis = signedAxis(u);
  const vAxis = signedAxis(v);
  const dot =
    uAxis === null || vAxis === null
      ? null
      : uAxis[0] * vAxis[0] + uAxis[1] * vAxis[1] + uAxis[2] * vAxis[2];
  if (uAxis === null || vAxis === null || dot !== 0) {
    report(
      context,
      node.sourcePath,
      properties.get('u-axis')?.span ?? node.span,
      'asset.geometry-axis',
      'Plane axes must be distinct signed orthogonal unit axes.',
    );
    return null;
  }
  const normal = freeze([
    uAxis[1] * vAxis[2] - uAxis[2] * vAxis[1],
    uAxis[2] * vAxis[0] - uAxis[0] * vAxis[2],
    uAxis[0] * vAxis[1] - uAxis[1] * vAxis[0],
  ]) as Vec3;
  return { normal, uAxis, vAxis };
};

interface PlaneInputs {
  readonly properties: ReadonlyMap<string, PropertyEntry>;
  readonly origin: readonly AssetExactNumber[];
  readonly size: readonly AssetExactNumber[];
  readonly basis: PlaneBasis;
}

const readPlaneInputs = (node: InstantiatedGeometryNode, context: Context): PlaneInputs | null => {
  const properties = propertyMap(
    node,
    PLANE_ALLOWED,
    ['origin', 'size', 'u-axis', 'v-axis'],
    context,
  );
  const origin = exactVector(
    properties.get('origin'),
    'vec3<unit>',
    context,
    node.sourcePath,
    node.span,
  );
  const size = exactVector(
    properties.get('size'),
    'vec2<unit>',
    context,
    node.sourcePath,
    node.span,
  );
  const u = exactVector(
    properties.get('u-axis'),
    'vec3<unit>',
    context,
    node.sourcePath,
    node.span,
  );
  const v = exactVector(
    properties.get('v-axis'),
    'vec3<unit>',
    context,
    node.sourcePath,
    node.span,
  );
  if (origin === null || size === null || u === null || v === null || !positiveIntegral(size)) {
    if (size !== null && !positiveIntegral(size)) {
      report(
        context,
        node.sourcePath,
        properties.get('size')?.span ?? node.span,
        'asset.geometry-size',
        'Plane size must contain positive integral unit components.',
      );
    }
    return null;
  }
  const basis = planeBasis(u, v, properties, node, context);
  return basis === null ? null : { properties, origin, size, basis };
};

const buildPlaneFaces = (
  surface: SurfacePlan,
  sizeNumbers: Vec2,
): {
  readonly sidedness: 'front' | 'double';
  readonly textureId: string;
  readonly faces: PlaneFaces;
} => {
  const uv: UvRect = freeze([
    surface.chart.origin[0],
    surface.chart.origin[1],
    surface.chart.origin[0] + sizeNumbers[0],
    surface.chart.origin[1] + sizeNumbers[1],
  ]);
  const textureId = surface.plan.texture.id;
  const sidedness = surface.material === 'double' ? 'double' : 'front';
  const makeFace = (enabled: boolean): CubeFace => freeze({ enabled, textureId, uv, rotation: 0 });
  return {
    sidedness,
    textureId,
    faces: { front: makeFace(true), back: makeFace(sidedness === 'double') },
  };
};

const readPlaneCanonical = (
  node: InstantiatedGeometryNode,
  inputs: PlaneInputs,
  surfaces: SurfaceBindings,
  plans: ReadonlyMap<string, AssetTexturePlan>,
  context: Context,
) => {
  const originNumbers = exactToVector3(
    inputs.origin,
    NUMBER_BOUNDARY,
    context,
    node.sourcePath,
    inputs.properties.get('origin')?.span ?? node.span,
  );
  const sizeNumbers = exactToVector2(
    inputs.size,
    INTEGER_BOUNDARY,
    context,
    node.sourcePath,
    inputs.properties.get('size')?.span ?? node.span,
  );
  const transform = transformFor(
    inputs.properties,
    context,
    node.sourcePath,
    node.span,
    true,
    originNumbers ?? undefined,
  );
  const surface = surfacePlan(node, surfaces, plans, context, 'flat');
  if (originNumbers === null || sizeNumbers === null || transform === null || surface === null) {
    return null;
  }
  return { sizeNumbers, transform, surface };
};

export const lowerPlane = (
  record: GeometryRecord,
  parentId: string,
  surfaces: SurfaceBindings,
  plans: ReadonlyMap<string, AssetTexturePlan>,
  context: Context,
): SceneNode | null => {
  const node = record.node;
  const inputs = readPlaneInputs(node, context);
  if (inputs === null) return null;
  const canonical = readPlaneCanonical(node, inputs, surfaces, plans, context);
  if (canonical === null) return null;
  const { sizeNumbers, transform, surface } = canonical;
  if (surface.chart.width !== sizeNumbers[0] || surface.chart.height !== sizeNumbers[1]) {
    report(
      context,
      node.sourcePath,
      node.surface!.span,
      'asset.geometry-surface',
      'Flat chart dimensions must exactly match the plane size.',
    );
  }
  const { sidedness, textureId, faces } = buildPlaneFaces(surface, sizeNumbers);
  return {
    id: node.id,
    kind: 'plane',
    name: node.id,
    parentId,
    size: sizeNumbers,
    transform,
    visible: visibleFor(inputs.properties, context, node),
    sidedness,
    coverageId: `${textureId}\u0000${surface.chart.id}`,
    basis: freeze({
      normal: inputs.basis.normal,
      uAxis: inputs.basis.uAxis,
      vAxis: inputs.basis.vAxis,
      orientation: 'normal',
    }),
    faces,
  };
};
