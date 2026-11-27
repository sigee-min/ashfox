import { freeze } from '../../../immutable';
import type { UvRect, Vec2 } from '../../../model/identity';
import type { CubeFaces, SceneNode, TaperNode, WedgeNode } from '../../../model/scene';
import type { InstantiatedGeometryNode } from './ir';
import type { AssetTexturePlan } from './texture/contract';
import {
  CUBE_FACES,
  INTEGER_BOUNDARY,
  MAX_SAFE,
  NUMBER_BOUNDARY,
  addExact,
  boolean,
  canonical,
  cubeUv,
  exactNumber,
  exactToVector2,
  exactToVector3,
  exactVector,
  positiveIntegral,
  propertyMap,
  report,
  surfacePlan,
  transformFor,
  visibleFor,
  type Context,
  type GeometryRecord,
  type SurfaceBindings,
  type SurfacePlan,
} from './geometrySupport';

const TAPER_ALLOWED = new Set([
  'origin',
  'size',
  'top_scale',
  'position',
  'rotation',
  'pivot',
  'visible',
  'inflate',
  'mirror',
]);

const WEDGE_ALLOWED = new Set([
  'origin',
  'size',
  'position',
  'rotation',
  'pivot',
  'visible',
  'inflate',
  'mirror',
]);

const CYLINDER_ALLOWED = new Set([
  'origin',
  'radius',
  'radius_top',
  'height',
  'sides',
  'position',
  'rotation',
  'pivot',
  'visible',
]);

const RATIO_BOUNDARY = Object.freeze({ minimum: 0, maximum: 1000, integral: false });
const POSITIVE_BOUNDARY = Object.freeze({ minimum: 1e-4, maximum: MAX_SAFE, integral: false });

const buildPrimitiveFaces = (
  surface: SurfacePlan,
  uv: Readonly<Record<(typeof CUBE_FACES)[number], UvRect>>,
): CubeFaces => ({
  north: freeze({ enabled: true, textureId: surface.plan.texture.id, uv: uv.north, rotation: 0 }),
  south: freeze({ enabled: true, textureId: surface.plan.texture.id, uv: uv.south, rotation: 0 }),
  east: freeze({ enabled: true, textureId: surface.plan.texture.id, uv: uv.east, rotation: 0 }),
  west: freeze({ enabled: true, textureId: surface.plan.texture.id, uv: uv.west, rotation: 0 }),
  up: freeze({ enabled: true, textureId: surface.plan.texture.id, uv: uv.up, rotation: 0 }),
  down: freeze({ enabled: true, textureId: surface.plan.texture.id, uv: uv.down, rotation: 0 }),
});

const readBoxInflate = (
  entry: ReturnType<ReturnType<typeof propertyMap>['get']>,
  context: Context,
  sourcePath: string,
  nodeSpan: InstantiatedGeometryNode['span'],
): number | null => {
  if (entry === undefined) return 0;
  const inflateExact = exactNumber(entry, 'unit', context, sourcePath, nodeSpan);
  if (inflateExact === null) return null;
  return canonical(inflateExact, NUMBER_BOUNDARY, context, sourcePath, entry.span);
};

const readBoxExtents = (
  node: InstantiatedGeometryNode,
  properties: ReturnType<typeof propertyMap>,
  context: Context,
) => {
  const originExact = exactVector(
    properties.get('origin'),
    'vec3<unit>',
    context,
    node.sourcePath,
    node.span,
  );
  const sizeExact = exactVector(
    properties.get('size'),
    'vec3<unit>',
    context,
    node.sourcePath,
    node.span,
  );
  if (originExact === null || sizeExact === null || !positiveIntegral(sizeExact)) {
    if (sizeExact !== null && !positiveIntegral(sizeExact)) {
      report(
        context,
        node.sourcePath,
        properties.get('size')?.span ?? node.span,
        'asset.geometry-size',
        `${node.kind} size must contain positive integral unit components.`,
      );
    }
    return null;
  }
  const toExact = [
    addExact(originExact[0]!, sizeExact[0]!),
    addExact(originExact[1]!, sizeExact[1]!),
    addExact(originExact[2]!, sizeExact[2]!),
  ];
  const from = exactToVector3(originExact, NUMBER_BOUNDARY, context, node.sourcePath, node.span);
  const to = exactToVector3(toExact, NUMBER_BOUNDARY, context, node.sourcePath, node.span);
  const size = exactToVector3(sizeExact, INTEGER_BOUNDARY, context, node.sourcePath, node.span);
  return from && to && size ? { from, to, size } : null;
};

const readBoxBounds = (
  node: InstantiatedGeometryNode,
  allowed: ReadonlySet<string>,
  required: readonly string[],
  surfaces: SurfaceBindings,
  plans: ReadonlyMap<string, AssetTexturePlan>,
  context: Context,
) => {
  const properties = propertyMap(node, allowed, required, context);
  const extents = readBoxExtents(node, properties, context);
  const transform = transformFor(properties, context, node.sourcePath, node.span, true);
  const inflate = readBoxInflate(properties.get('inflate'), context, node.sourcePath, node.span);
  const mirror = boolean(properties.get('mirror'), false, context, node.sourcePath);
  const surface = surfacePlan(node, surfaces, plans, context, 'box');
  if (!extents || !transform || inflate === null || mirror === null || !surface) return null;
  const d = surface.chart.density;
  const uv = cubeUv(surface.chart.origin, [
    extents.size[0] * d,
    extents.size[1] * d,
    extents.size[2] * d,
  ]);
  return {
    properties,
    from: extents.from,
    to: extents.to,
    transform,
    inflate,
    mirror,
    faces: buildPrimitiveFaces(surface, uv),
  };
};

export const lowerTaper = (
  record: GeometryRecord,
  parentId: string,
  surfaces: SurfaceBindings,
  plans: ReadonlyMap<string, AssetTexturePlan>,
  context: Context,
): SceneNode | null => {
  const node = record.node;
  const base = readBoxBounds(
    node,
    TAPER_ALLOWED,
    ['origin', 'size', 'top_scale'],
    surfaces,
    plans,
    context,
  );
  if (base === null) return null;
  const scaleExact = exactVector(
    base.properties.get('top_scale'),
    'vec2<ratio>',
    context,
    node.sourcePath,
    node.span,
  );
  const topScale: Vec2 | null =
    scaleExact === null
      ? null
      : exactToVector2(scaleExact, RATIO_BOUNDARY, context, node.sourcePath, node.span);
  if (topScale === null) return null;
  const res: TaperNode = {
    id: node.id,
    kind: 'taper',
    name: node.id,
    parentId,
    bounds: { from: base.from, to: base.to },
    topScale,
    axis: node.axis ?? 'y',
    transform: base.transform,
    visible: visibleFor(base.properties, context, node),
    inflate: base.inflate,
    mirror: base.mirror,
    faces: base.faces,
  };
  return res;
};

export const lowerWedge = (
  record: GeometryRecord,
  parentId: string,
  surfaces: SurfaceBindings,
  plans: ReadonlyMap<string, AssetTexturePlan>,
  context: Context,
): SceneNode | null => {
  const node = record.node;
  const base = readBoxBounds(node, WEDGE_ALLOWED, ['origin', 'size'], surfaces, plans, context);
  if (base === null) return null;
  const res: WedgeNode = {
    id: node.id,
    kind: 'wedge',
    name: node.id,
    parentId,
    bounds: { from: base.from, to: base.to },
    slope: node.slope ?? 'north',
    transform: base.transform,
    visible: visibleFor(base.properties, context, node),
    inflate: base.inflate,
    mirror: base.mirror,
    faces: base.faces,
  };
  return res;
};

const readUnitProp = (
  entry: ReturnType<typeof propertyMap> extends ReadonlyMap<string, infer V>
    ? V | undefined
    : never,
  boundary: Readonly<{ minimum: number; maximum: number; integral: boolean }>,
  context: Context,
  node: InstantiatedGeometryNode,
): number | null => {
  const exact = exactNumber(entry, 'unit', context, node.sourcePath, node.span);
  return exact === null ? null : canonical(exact, boundary, context, node.sourcePath, node.span);
};

const readCylinderSides = (
  properties: ReturnType<typeof propertyMap>,
  context: Context,
  node: InstantiatedGeometryNode,
): 6 | 8 | 12 | null => {
  const sidesEntry = properties.get('sides');
  if (sidesEntry === undefined) return 8;
  const sidesExact = exactNumber(sidesEntry, 'plain', context, node.sourcePath, node.span);
  if (sidesExact === null) return null;
  const sidesNum = canonical(
    sidesExact,
    INTEGER_BOUNDARY,
    context,
    node.sourcePath,
    sidesEntry.span,
  );
  if (sidesNum === 6 || sidesNum === 8 || sidesNum === 12) return sidesNum;
  if (sidesNum !== null) {
    report(
      context,
      node.sourcePath,
      sidesEntry.span,
      'asset.geometry-value',
      'Cylinder sides must be 6, 8, or 12.',
    );
  }
  return null;
};

const NON_NEGATIVE_BOUNDARY = Object.freeze({ minimum: 0, maximum: MAX_SAFE, integral: false });

const readCylinderDims = (
  properties: ReturnType<typeof propertyMap>,
  context: Context,
  node: InstantiatedGeometryNode,
) => {
  const originExact = exactVector(
    properties.get('origin'),
    'vec3<unit>',
    context,
    node.sourcePath,
    node.span,
  );
  const origin = originExact
    ? exactToVector3(originExact, NUMBER_BOUNDARY, context, node.sourcePath, node.span)
    : null;
  const radius = readUnitProp(properties.get('radius'), NON_NEGATIVE_BOUNDARY, context, node);
  const height = readUnitProp(properties.get('height'), POSITIVE_BOUNDARY, context, node);
  const topEntry = properties.get('radius_top');
  const radiusTop =
    topEntry === undefined ? radius : readUnitProp(topEntry, NON_NEGATIVE_BOUNDARY, context, node);
  const sides = readCylinderSides(properties, context, node);
  if (radius !== null && radiusTop !== null && radius <= 0 && radiusTop <= 0) {
    report(
      context,
      node.sourcePath,
      node.span,
      'asset.geometry-value',
      'Cylinder requires at least one positive end radius.',
    );
    return null;
  }
  if (!origin || radius === null || height === null || radiusTop === null || sides === null) {
    return null;
  }
  return { origin, radius, height, radiusTop, sides };
};

export const lowerCylinder = (
  record: GeometryRecord,
  parentId: string,
  surfaces: SurfaceBindings,
  plans: ReadonlyMap<string, AssetTexturePlan>,
  context: Context,
): SceneNode | null => {
  const node = record.node;
  const properties = propertyMap(node, CYLINDER_ALLOWED, ['origin', 'radius', 'height'], context);
  const dims = readCylinderDims(properties, context, node);
  const transform = transformFor(properties, context, node.sourcePath, node.span, true);
  const surface = surfacePlan(node, surfaces, plans, context, 'box');
  if (!dims || !transform || !surface) return null;
  const { origin, radius, height, radiusTop, sides } = dims;
  const d = surface.chart.density;
  const boxW = Math.max(1, Math.ceil(Math.max(radius, radiusTop) * 2));
  const boxH = Math.max(1, Math.ceil(height));
  const uv = cubeUv(surface.chart.origin, [boxW * d, boxH * d, boxW * d]);
  return {
    id: node.id,
    kind: 'cylinder',
    name: node.id,
    parentId,
    origin,
    radius,
    radiusTop,
    height,
    sides,
    axis: node.axis ?? 'y',
    transform,
    visible: visibleFor(properties, context, node),
    faces: buildPrimitiveFaces(surface, uv),
  };
};

/** Lower extended geometry primitive kinds (`taper`, `wedge`, `cylinder`). */
export const lowerCustomPrimRecord = (
  record: GeometryRecord,
  parentId: string,
  surfaces: SurfaceBindings,
  plans: ReadonlyMap<string, AssetTexturePlan>,
  context: Context,
): SceneNode | null => {
  if (record.node.kind === 'taper') return lowerTaper(record, parentId, surfaces, plans, context);
  if (record.node.kind === 'wedge') return lowerWedge(record, parentId, surfaces, plans, context);
  if (record.node.kind === 'cylinder')
    return lowerCylinder(record, parentId, surfaces, plans, context);
  return null;
};
