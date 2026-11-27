import { freeze } from '../../../immutable';
import type { UvRect } from '../../../model/identity';
import type { CubeFace, CubeFaces, SceneNode } from '../../../model/scene';
import type { InstantiatedGeometryNode, InstantiatedSocketConnection } from './ir';
import type { AssetTexturePlan } from './texture/contract';
import type { AssetExactNumber } from './value/contract';
import type { createGeometryLayout } from './canonicalLayout';
import { lowerAssetFrameToBoneTransform } from './frameLower';
import {
  CUBE_FACES,
  INTEGER_BOUNDARY,
  MAX_SAFE,
  NUMBER_BOUNDARY,
  addExact,
  boolean,
  canonical,
  cubeUv,
  directionOf,
  exactNumber,
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
  type PropertyEntry,
  type SurfaceBindings,
  type SurfacePlan,
} from './geometrySupport';

const CUBE_ALLOWED = new Set([
  'origin',
  'size',
  'position',
  'rotation',
  'pivot',
  'visible',
  'inflate',
  'mirror',
]);

const FACE_ALLOWED = new Set(['enabled', 'rotation']);

const lowerFaceRotation = (
  node: InstantiatedGeometryNode,
  properties: ReadonlyMap<string, PropertyEntry>,
  context: Context,
): 0 | 90 | 180 | 270 | null => {
  const entry = properties.get('rotation');
  if (entry === undefined) return 0;
  const exact = exactNumber(entry, 'plain', context, node.sourcePath, node.span);
  const value =
    exact === null
      ? null
      : canonical(exact, INTEGER_BOUNDARY, context, node.sourcePath, entry.span);
  if (value === null) return null;
  if (value !== 0 && value !== 90 && value !== 180 && value !== 270) {
    report(
      context,
      node.sourcePath,
      entry.span,
      'asset.geometry-face',
      'Face rotation must be exactly 0, 90, 180, or 270 degrees.',
    );
    return null;
  }
  return value as 0 | 90 | 180 | 270;
};

const cubeToExact = (
  origin: readonly AssetExactNumber[],
  size: readonly AssetExactNumber[],
  properties: ReadonlyMap<string, PropertyEntry>,
  node: InstantiatedGeometryNode,
  context: Context,
): readonly [AssetExactNumber, AssetExactNumber, AssetExactNumber] | null => {
  try {
    return [
      addExact(origin[0]!, size[0]!),
      addExact(origin[1]!, size[1]!),
      addExact(origin[2]!, size[2]!),
    ];
  } catch {
    report(
      context,
      node.sourcePath,
      properties.get('size')?.span ?? node.span,
      'asset.geometry-size',
      'Cube bounds exceed the exact arithmetic budget.',
    );
    return null;
  }
};

const cubeInflate = (
  properties: ReadonlyMap<string, PropertyEntry>,
  node: InstantiatedGeometryNode,
  context: Context,
): number | null => {
  if (!properties.has('inflate')) return 0;
  const entry = properties.get('inflate')!;
  const inflateExact = exactNumber(entry, 'unit', context, node.sourcePath, node.span);
  return inflateExact === null
    ? null
    : canonical(inflateExact, NUMBER_BOUNDARY, context, node.sourcePath, entry.span);
};

const verifyBoxChart = (
  node: InstantiatedGeometryNode,
  size: readonly AssetExactNumber[],
  surface: SurfacePlan,
  context: Context,
): void => {
  const d = BigInt(surface.chart.density);
  const expectedWidth = (2n * size[0]!.numerator + 2n * size[2]!.numerator) * d;
  const expectedHeight = (size[1]!.numerator + size[2]!.numerator) * d;
  const chartMatches =
    expectedWidth <= BigInt(MAX_SAFE) &&
    expectedHeight <= BigInt(MAX_SAFE) &&
    BigInt(surface.chart.width) === expectedWidth &&
    BigInt(surface.chart.height) === expectedHeight;
  if (!chartMatches) {
    report(
      context,
      node.sourcePath,
      node.surface!.span,
      'asset.geometry-surface',
      'Box chart dimensions must exactly match the cube box UV net.',
    );
  }
};

const collectCubeFaces = (
  node: InstantiatedGeometryNode,
  context: Context,
): ReadonlyMap<string, InstantiatedGeometryNode> => {
  const faceByDirection = new Map<string, InstantiatedGeometryNode>();
  for (const child of node.children) {
    if (child.kind !== 'face') continue;
    const direction = directionOf(child);
    if (!CUBE_FACES.some((candidate) => candidate === direction)) {
      report(
        context,
        child.sourcePath,
        child.span,
        'asset.geometry-face',
        'Cube faces must use one of the six canonical directions.',
      );
    } else if (faceByDirection.has(direction)) {
      report(
        context,
        child.sourcePath,
        child.span,
        'asset.duplicate-geometry-face',
        `Cube face "${direction}" is declared more than once.`,
      );
    } else {
      faceByDirection.set(direction, child);
    }
  }
  return faceByDirection;
};

const flipRectU = (rect: UvRect): UvRect => freeze([rect[2], rect[1], rect[0], rect[3]]);

const mirroredCubeUvs = (
  uv: Readonly<Record<(typeof CUBE_FACES)[number], UvRect>>,
): Readonly<Record<(typeof CUBE_FACES)[number], UvRect>> =>
  freeze({
    north: flipRectU(uv.north),
    south: flipRectU(uv.south),
    up: flipRectU(uv.up),
    down: flipRectU(uv.down),
    west: flipRectU(uv.east),
    east: flipRectU(uv.west),
  });

const mirrorFaceRotation = (rotation: 0 | 90 | 180 | 270): 0 | 90 | 180 | 270 => {
  if (rotation === 90) return 270;
  if (rotation === 270) return 90;
  return rotation;
};

const buildCubeFace = (
  direction: (typeof CUBE_FACES)[number],
  faceByDirection: ReadonlyMap<string, InstantiatedGeometryNode>,
  surface: SurfacePlan,
  uv: Readonly<Record<(typeof CUBE_FACES)[number], UvRect>>,
  flipRotation: boolean,
  context: Context,
): CubeFace => {
  const child = faceByDirection.get(direction);
  const childProperties =
    child === undefined
      ? new Map<string, PropertyEntry>()
      : propertyMap(child, FACE_ALLOWED, [], context);
  if (child !== undefined && child.surface !== null) {
    report(
      context,
      child.sourcePath,
      child.surface.span,
      'asset.geometry-surface',
      'Face nodes cannot own surface bindings.',
    );
  }
  const enabled =
    child === undefined
      ? true
      : boolean(childProperties.get('enabled'), true, context, child.sourcePath);
  const rawRot =
    child === undefined ? 0 : (lowerFaceRotation(child, childProperties, context) ?? 0);
  const rotation = flipRotation ? mirrorFaceRotation(rawRot) : rawRot;
  return freeze({
    enabled: enabled ?? false,
    textureId: surface.plan.texture.id,
    uv: uv[direction],
    rotation,
  });
};

const readCubeInputs = (node: InstantiatedGeometryNode, context: Context) => {
  const properties = propertyMap(node, CUBE_ALLOWED, ['origin', 'size'], context);
  const origin = exactVector(
    properties.get('origin'),
    'vec3<unit>',
    context,
    node.sourcePath,
    node.span,
  );
  const size = exactVector(
    properties.get('size'),
    'vec3<unit>',
    context,
    node.sourcePath,
    node.span,
  );
  if (origin === null || size === null || !positiveIntegral(size)) {
    if (size !== null && !positiveIntegral(size)) {
      report(
        context,
        node.sourcePath,
        properties.get('size')?.span ?? node.span,
        'asset.geometry-size',
        'Cube size must contain positive integral unit components.',
      );
    }
    return null;
  }
  const to = cubeToExact(origin, size, properties, node, context);
  return to === null ? null : { properties, origin, size, to };
};

const readCubeCanonical = (
  node: InstantiatedGeometryNode,
  inputs: NonNullable<ReturnType<typeof readCubeInputs>>,
  surfaces: SurfaceBindings,
  plans: ReadonlyMap<string, AssetTexturePlan>,
  context: Context,
) => {
  const { properties, origin, size, to } = inputs;
  const originSpan = properties.get('origin')?.span ?? node.span;
  const sizeSpan = properties.get('size')?.span ?? node.span;
  const originNumbers = exactToVector3(
    origin,
    NUMBER_BOUNDARY,
    context,
    node.sourcePath,
    originSpan,
  );
  const toNumbers = exactToVector3(to, NUMBER_BOUNDARY, context, node.sourcePath, sizeSpan);
  const sizeNumbers = exactToVector3(size, INTEGER_BOUNDARY, context, node.sourcePath, sizeSpan);
  const transform = transformFor(properties, context, node.sourcePath, node.span, true);
  const inflate = cubeInflate(properties, node, context);
  const mirror = boolean(properties.get('mirror'), false, context, node.sourcePath);
  const surface = surfacePlan(node, surfaces, plans, context, 'box');
  if (
    originNumbers === null ||
    toNumbers === null ||
    sizeNumbers === null ||
    transform === null ||
    inflate === null ||
    mirror === null ||
    surface === null
  ) {
    return null;
  }
  return { originNumbers, toNumbers, sizeNumbers, transform, inflate, mirror, surface };
};

export const lowerCube = (
  record: GeometryRecord,
  parentId: string,
  surfaces: SurfaceBindings,
  plans: ReadonlyMap<string, AssetTexturePlan>,
  context: Context,
): SceneNode | null => {
  const node = record.node;
  const inputs = readCubeInputs(node, context);
  if (inputs === null) return null;
  const canonical = readCubeCanonical(node, inputs, surfaces, plans, context);
  if (canonical === null) return null;
  const { originNumbers, toNumbers, sizeNumbers, transform, inflate, mirror, surface } = canonical;
  verifyBoxChart(node, inputs.size, surface, context);
  const d = surface.chart.density;
  const baseUv = cubeUv(surface.chart.origin, [
    sizeNumbers[0] * d,
    sizeNumbers[1] * d,
    sizeNumbers[2] * d,
  ]);
  const uvMirrorX = node.uvMirrorX === true;
  const useBoxUv = !uvMirrorX && d === 1;
  const bakedMirror = useBoxUv ? false : uvMirrorX !== mirror;
  const uv = bakedMirror ? mirroredCubeUvs(baseUv) : baseUv;
  const faceByDirection = collectCubeFaces(node, context);
  const faces: CubeFaces = {
    north: buildCubeFace('north', faceByDirection, surface, uv, bakedMirror, context),
    south: buildCubeFace('south', faceByDirection, surface, uv, bakedMirror, context),
    east: buildCubeFace('east', faceByDirection, surface, uv, bakedMirror, context),
    west: buildCubeFace('west', faceByDirection, surface, uv, bakedMirror, context),
    up: buildCubeFace('up', faceByDirection, surface, uv, bakedMirror, context),
    down: buildCubeFace('down', faceByDirection, surface, uv, bakedMirror, context),
  };
  return {
    id: node.id,
    kind: 'cube',
    name: node.id,
    parentId,
    geometryMode: 'axis-box',
    bounds: { from: originNumbers, to: toNumbers },
    transform,
    visible: visibleFor(inputs.properties, context, node),
    inflate,
    mirror: useBoxUv ? mirror : false,
    boxUv: useBoxUv,
    ...(useBoxUv ? { uvOffset: freeze([surface.chart.origin[0], surface.chart.origin[1]]) } : {}),
    faces,
  };
};

export const lowerLocator = (
  record: GeometryRecord,
  parentId: string,
  context: Context,
): SceneNode | null => {
  const node = record.node;
  const properties = propertyMap(node, new Set(['position', 'rotation', 'visible']), [], context);
  if (node.surface !== null || node.children.length > 0) {
    report(
      context,
      node.sourcePath,
      node.span,
      'asset.invalid-geometry-scope',
      'Locator nodes cannot contain surfaces or geometry children.',
    );
  }
  const transform = transformFor(properties, context, node.sourcePath, node.span, false);
  return transform === null
    ? null
    : {
        id: node.id,
        kind: 'locator',
        name: node.id,
        parentId,
        transform,
        visible: visibleFor(properties, context, node),
      };
};

const lowerPrivateBone = (
  record: GeometryRecord,
  parentId: string,
  context: Context,
): SceneNode | null => {
  const node = record.node;
  const properties = propertyMap(
    node,
    new Set(['position', 'rotation', 'pivot', 'visible']),
    [],
    context,
  );
  if (node.surface !== null) {
    report(
      context,
      node.sourcePath,
      node.span,
      'asset.geometry-surface',
      'Bone nodes cannot own surface chart bindings.',
    );
  }
  const transform = transformFor(properties, context, node.sourcePath, node.span, true);
  return transform === null
    ? null
    : {
        id: node.id,
        kind: 'bone',
        name: node.id,
        parentId,
        transform,
        visible: visibleFor(properties, context, node),
      };
};

export const lowerGeometryBone = (
  record: GeometryRecord,
  parent: string,
  layout: ReturnType<typeof createGeometryLayout>,
  connections: ReadonlyMap<string, InstantiatedSocketConnection>,
  context: Context,
): SceneNode | null => {
  const connection = connections.get(record.node.id);
  if (connection === undefined) return lowerPrivateBone(record, parent, context);
  const frame = layout.connectionFrame(connection);
  const transform = frame === null ? null : lowerAssetFrameToBoneTransform(frame);
  if (transform !== null) {
    return {
      id: record.node.id,
      kind: 'bone',
      name: record.node.id,
      parentId: parent,
      transform,
      visible: true,
    };
  }
  report(
    context,
    record.node.sourcePath,
    connection.span,
    'asset.connection-frame',
    'Socket local placement has no canonical transform.',
  );
  return null;
};
