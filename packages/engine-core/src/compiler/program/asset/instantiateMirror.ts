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

const mirrorCubeOrigin = (
  origin: AssetVectorValue,
  size: AssetVectorValue | undefined,
): AssetVectorValue => {
  if (size === undefined || origin.values.length !== 3 || size.values.length !== 3) {
    return negateVectorAxis(origin, [true, false, false]);
  }
  const ox = origin.values[0]!.value;
  const sx = size.values[0]!.value;
  const mirroredX = assetNumberValue(
    assetExactNumber(
      -(ox.numerator * sx.denominator + sx.numerator * ox.denominator),
      ox.denominator * sx.denominator,
      ox.unit,
    ),
  );
  return assetVectorValue([mirroredX, origin.values[1]!, origin.values[2]!], origin.type);
};

const vectorValue = (
  properties: readonly InstantiatedGeometryProperty[],
  name: string,
): AssetVectorValue | undefined => {
  const value = properties.find((entry) => entry.name === name)?.value;
  return value?.kind === 'vector' ? value : undefined;
};

const mirrorPropertyValue = (
  property: InstantiatedGeometryProperty,
  kind: 'cube' | 'plane',
  size: AssetVectorValue | undefined,
): AssetValue => {
  const value = property.value;
  if (value.kind !== 'vector') return value;
  if (property.name === 'origin') {
    return kind === 'cube'
      ? mirrorCubeOrigin(value, size)
      : negateVectorAxis(value, [true, false, false]);
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

const mirrorCubeProperties = (
  properties: readonly InstantiatedGeometryProperty[],
  kind: 'cube' | 'plane',
): readonly InstantiatedGeometryProperty[] => {
  const size = vectorValue(properties, 'size');
  const mapped = properties.map((property) =>
    freeze({
      name: property.name,
      value: mirrorPropertyValue(property, kind, size),
      span: property.span,
    }),
  );
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

/** Synthesize the X-mirrored sibling node for a cube or plane declaring mirror = x. */
export const mirrorInstantiatedNode = (
  node: InstantiatedGeometryNode,
  mirroredId: string,
  span: SourceSpan,
): InstantiatedGeometryNode => {
  const kind = node.kind === 'plane' ? 'plane' : 'cube';
  return freeze({
    kind: node.kind,
    id: mirroredId,
    attachmentBoneId: node.attachmentBoneId,
    properties: mirrorCubeProperties(node.properties, kind),
    surface: node.surface,
    children: mirrorChildFaces(node.children, mirroredId),
    ...(kind === 'cube' ? { uvMirrorX: !(node.uvMirrorX === true) } : {}),
    sourcePath: node.sourcePath,
    span,
  });
};
