import type { ProgramExpr } from '../../../project/program/syntax/contract';
import type { SourceSpan } from '../../../project/source/contract';
import type { AssetFrameDecl } from '../../../project/program/asset/contract';
import { type AssetValue } from './value/contract';
import {
  isAssetExactFrame,
  type AssetExactFrame,
  type AssetExactUnitVector,
  type AssetSignedAxis,
  type AssetSignedCoordinate,
} from './frame';
import type { TypedFrame } from './contract';
import {
  compileHirExpression,
  exactUnitVector,
  exactZeroUnitVector,
  evaluateHirExpression,
  type HirIssue,
} from './hirValues';

const freeze = <T>(value: T): T => Object.freeze(value);

const identityFrame = (): TypedFrame =>
  freeze({
    origin: exactZeroUnitVector(),
    xAxis: freeze([1, 0, 0]) as AssetSignedAxis,
    yAxis: freeze([0, 1, 0]) as AssetSignedAxis,
    zAxis: freeze([0, 0, 1]) as AssetSignedAxis,
    determinant: 1,
  });

export const identityTypedFrame = identityFrame;

const propertyMap = (
  declaration: AssetFrameDecl,
  path: string,
  issue: HirIssue,
): ReadonlyMap<string, AssetFrameDecl['properties'][number]> => {
  const properties = new Map<string, AssetFrameDecl['properties'][number]>();
  for (const property of declaration.properties) {
    if (properties.has(property.name))
      issue(
        path,
        property.span,
        'asset.duplicate-frame-field',
        'Frame field "' + property.name + '" is declared more than once.',
      );
    else properties.set(property.name, property);
    if (
      property.name !== 'origin' &&
      property.name !== 'x' &&
      property.name !== 'y' &&
      property.name !== 'z'
    )
      issue(
        path,
        property.span,
        'asset.invalid-frame',
        'Frames only accept origin, x, y, and z fields.',
      );
  }
  return properties;
};

const signedCoordinate = (value: AssetValue): AssetSignedCoordinate | null => {
  if (value.kind !== 'number' || value.type !== 'integer' || value.value.denominator !== 1n)
    return null;
  if (value.value.numerator === -1n) return -1;
  if (value.value.numerator === 0n) return 0;
  if (value.value.numerator === 1n) return 1;
  return null;
};

const axis = (
  expression: ProgramExpr | undefined,
  path: string,
  ownerSpan: SourceSpan,
  issue: HirIssue,
): AssetSignedAxis | null => {
  if (expression === undefined || expression.kind !== 'vector' || expression.values.length !== 3) {
    issue(
      path,
      expression?.span ?? ownerSpan,
      'asset.invalid-frame',
      'Frame axes require exact three-component signed integer vectors.',
    );
    return null;
  }
  const values: AssetSignedCoordinate[] = [];
  for (const component of expression.values) {
    const typed = compileHirExpression(component, 'integer', new Map(), path, issue);
    const value = typed === null ? null : evaluateHirExpression(typed, new Map(), path, issue);
    const coordinate = value === null ? null : signedCoordinate(value);
    if (coordinate === null)
      issue(
        path,
        component.span,
        'asset.invalid-frame',
        'Frame axes require exact coordinates from -1, 0, or 1.',
      );
    else values.push(coordinate);
  }
  if (values.length !== 3) return null;
  return freeze([values[0]!, values[1]!, values[2]!]) as AssetSignedAxis;
};

const origin = (
  expression: ProgramExpr | undefined,
  path: string,
  issue: HirIssue,
): AssetExactUnitVector | null => {
  if (expression === undefined) return exactZeroUnitVector();
  const typed = compileHirExpression(expression, 'vec3<unit>', new Map(), path, issue);
  const value = typed === null ? null : evaluateHirExpression(typed, new Map(), path, issue);
  return value === null
    ? null
    : (exactUnitVector(value) ??
        (() => {
          issue(
            path,
            expression.span,
            'asset.invalid-frame',
            'Frame origin requires an exact vec3<unit>.',
          );
          return null;
        })());
};

const determinant = (x: AssetSignedAxis, y: AssetSignedAxis, z: AssetSignedAxis): -1 | 1 | null => {
  const cross: AssetSignedAxis = freeze([
    x[1] * y[2] - x[2] * y[1],
    x[2] * y[0] - x[0] * y[2],
    x[0] * y[1] - x[1] * y[0],
  ]) as AssetSignedAxis;
  const matches = cross.every((value, index) => value === z[index]);
  if (matches) return 1;
  if (cross.every((value, index) => value === -z[index])) return -1;
  return null;
};

export const buildTypedFrame = (
  path: string,
  declaration: AssetFrameDecl | null,
  explicitOrigin: ProgramExpr | null,
  required: boolean,
  ownerSpan: SourceSpan,
  handedness: 'right' | 'left',
  issue: HirIssue,
): TypedFrame | null => {
  if (declaration === null) {
    if (required)
      issue(path, ownerSpan, 'asset.missing-frame', 'This declaration requires an explicit frame.');
    return required ? null : identityFrame();
  }
  const properties = propertyMap(declaration, path, issue);
  if (explicitOrigin !== null && properties.has('origin')) {
    issue(
      path,
      properties.get('origin')!.span,
      'asset.duplicate-frame-origin',
      'A frame cannot combine a separate origin with a frame origin.',
    );
    return null;
  }
  const x = axis(properties.get('x')?.value, path, declaration.span, issue);
  const y = axis(properties.get('y')?.value, path, declaration.span, issue);
  const z = axis(properties.get('z')?.value, path, declaration.span, issue);
  const frameOrigin = explicitOrigin ?? properties.get('origin')?.value;
  const o = origin(frameOrigin, path, issue);
  if (x === null || y === null || z === null || o === null) return null;
  const sign = determinant(x, y, z);
  const expected = handedness === 'right' ? 1 : -1;
  if (sign === null || sign !== expected) {
    issue(
      path,
      declaration.span,
      'asset.invalid-frame',
      'Frame axes must be signed orthonormal axes with the declared handedness.',
    );
    return null;
  }
  const frame: AssetExactFrame = freeze({
    origin: freeze([...o]) as AssetExactUnitVector,
    xAxis: x,
    yAxis: y,
    zAxis: z,
    determinant: sign,
  });
  return isAssetExactFrame(frame) ? frame : null;
};
