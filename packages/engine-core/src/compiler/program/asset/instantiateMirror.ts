import { freeze } from '../../../immutable';
import type { SourceSpan } from '../../../project/source/contract';
import type { InstantiatedGeometryNode, InstantiatedGeometryProperty } from './ir';
import {
  assetExactNumber,
  assetNumberValue,
  assetVectorValue,
  type AssetNumberValue,
  type AssetValue,
  type AssetVectorValue,
} from './value/contract';

const negateNumber = (entry: AssetNumberValue): AssetNumberValue =>
  assetNumberValue(
    assetExactNumber(-entry.value.numerator, entry.value.denominator, entry.value.unit),
  );

const negateVectorAxis = (vector: AssetVectorValue, mask: readonly boolean[]): AssetVectorValue =>
  assetVectorValue(
    vector.values.map((entry, index) => (mask[index] ? negateNumber(entry) : entry)),
    vector.type,
  );

const mirrorOriginAlongSpanX = (
  origin: AssetVectorValue,
  extentX: AssetNumberValue,
): AssetVectorValue => {
  if (origin.values.length !== 3) return negateVectorAxis(origin, [true, false, false]);
  const ox = origin.values[0]!.value;
  const sx = extentX.value;
  const mirroredX = assetNumberValue(
    assetExactNumber(
      -(ox.numerator * sx.denominator + sx.numerator * ox.denominator),
      ox.denominator * sx.denominator,
      ox.unit,
    ),
  );
  return assetVectorValue([mirroredX, origin.values[1]!, origin.values[2]!], origin.type);
};

const mirrorCubeOrigin = (
  origin: AssetVectorValue,
  size: AssetVectorValue | undefined,
): AssetVectorValue => {
  if (size === undefined || size.values.length !== 3) {
    return negateVectorAxis(origin, [true, false, false]);
  }
  return mirrorOriginAlongSpanX(origin, size.values[0]!);
};

const vectorValue = (
  properties: readonly InstantiatedGeometryProperty[],
  name: string,
): AssetVectorValue | undefined => {
  const value = properties.find((entry) => entry.name === name)?.value;
  return value?.kind === 'vector' ? value : undefined;
};

const unitNumberValue = (
  properties: readonly InstantiatedGeometryProperty[],
  name: string,
): AssetNumberValue | undefined => {
  const value = properties.find((entry) => entry.name === name)?.value;
  return value?.kind === 'number' && value.value.unit === 'unit' ? value : undefined;
};

const BOX_KINDS = new Set(['cube', 'taper', 'wedge']);

const mirrorPropertyValue = (
  property: InstantiatedGeometryProperty,
  kind: InstantiatedGeometryNode['kind'],
  axis: InstantiatedGeometryNode['axis'],
  size: AssetVectorValue | undefined,
  height: AssetNumberValue | undefined,
): AssetValue => {
  const value = property.value;
  if (value.kind !== 'vector') return value;
  if (property.name === 'origin') {
    if (BOX_KINDS.has(kind)) return mirrorCubeOrigin(value, size);
    if (kind === 'cylinder' && axis === 'x' && height !== undefined) {
      return mirrorOriginAlongSpanX(value, height);
    }
    return negateVectorAxis(value, [true, false, false]);
  }
  if (property.name === 'rotation') return negateVectorAxis(value, [false, true, true]);
  if (
    property.name === 'position' ||
    property.name === 'pivot' ||
    property.name === 'u_axis' ||
    property.name === 'v_axis'
  ) {
    return negateVectorAxis(value, [true, false, false]);
  }
  return value;
};

const swapCylinderEndRadii = (
  mapped: InstantiatedGeometryProperty[],
  radius: AssetNumberValue | undefined,
  radiusTop: AssetNumberValue | undefined,
): readonly InstantiatedGeometryProperty[] => {
  if (radius === undefined || radiusTop === undefined) return mapped;
  return mapped.map((prop) => {
    if (prop.name === 'radius') return freeze({ ...prop, value: radiusTop });
    if (prop.name === 'radius_top') return freeze({ ...prop, value: radius });
    return prop;
  });
};

const mirrorCubeProperties = (
  properties: readonly InstantiatedGeometryProperty[],
  kind: InstantiatedGeometryNode['kind'],
  axis: InstantiatedGeometryNode['axis'],
): readonly InstantiatedGeometryProperty[] => {
  const size = vectorValue(properties, 'size');
  const height = unitNumberValue(properties, 'height');
  const mapped = properties.map((property) =>
    freeze({
      name: property.name,
      value: mirrorPropertyValue(property, kind, axis, size, height),
      span: property.span,
    }),
  );
  if (kind === 'cylinder' && axis === 'x') {
    const r = unitNumberValue(properties, 'radius');
    const rTop = unitNumberValue(properties, 'radius_top');
    return freeze(swapCylinderEndRadii(mapped, r, rTop));
  }
  return freeze(mapped);
};

const swapFaceSuffix = (faceId: string): string => {
  const slash = faceId.lastIndexOf('/');
  const suffix = slash >= 0 ? faceId.slice(slash + 1) : faceId;
  if (suffix === 'east') return 'west';
  if (suffix === 'west') return 'east';
  return suffix;
};

const mirrorChildFaces = (
  children: readonly InstantiatedGeometryNode[],
  mirroredParentId: string,
): readonly InstantiatedGeometryNode[] =>
  freeze(
    children.map((child) => {
      const faceName = swapFaceSuffix(child.id);
      return freeze({
        kind: child.kind,
        id: `${mirroredParentId}/${faceName}`,
        attachmentBoneId: child.attachmentBoneId,
        properties: child.properties,
        surface: child.surface,
        children: child.children,
        sourcePath: child.sourcePath,
        span: child.span,
      });
    }),
  );

const mirroredSlope = (
  slope: InstantiatedGeometryNode['slope'],
): InstantiatedGeometryNode['slope'] => {
  if (slope === 'east') return 'west';
  if (slope === 'west') return 'east';
  return slope;
};

/** Synthesize the X-mirrored sibling node for a surface primitive declaring mirror_x. */
export const mirrorInstantiatedNode = (
  node: InstantiatedGeometryNode,
  mirroredId: string,
  span: SourceSpan,
): InstantiatedGeometryNode => {
  const hasBoxMirror = BOX_KINDS.has(node.kind);
  const slope = mirroredSlope(node.slope);
  return freeze({
    kind: node.kind,
    id: mirroredId,
    attachmentBoneId: node.attachmentBoneId,
    properties: mirrorCubeProperties(node.properties, node.kind, node.axis),
    surface: node.surface,
    children: mirrorChildFaces(node.children, mirroredId),
    ...(hasBoxMirror ? { uvMirrorX: !(node.uvMirrorX === true) } : {}),
    ...(node.axis !== undefined ? { axis: node.axis } : {}),
    ...(slope !== undefined ? { slope } : {}),
    sourcePath: node.sourcePath,
    span,
  });
};
