import { freeze } from '../../../immutable';
import type {
  AssetGeometryBlock,
  AssetGeometryProperty,
} from '../../../project/program/asset/contract';
import type { AssetExpectedType } from './value/contract';
import { compileHirExpression, type HirIssue } from './hirValues';
import type {
  TypedGeometryMirrorBind,
  TypedGeometryProperty,
  TypedGeometryStatement,
} from './contract';

export interface GeomExtraContext {
  readonly path: string;
  readonly environment: Parameters<typeof compileHirExpression>[2];
  readonly issue: HirIssue;
  readonly surfaceChart: (port: string, chart: string) => boolean;
}

const compileProperty = (
  property: AssetGeometryProperty,
  expected: AssetExpectedType,
  context: GeomExtraContext,
): TypedGeometryProperty | null => {
  const expression = compileHirExpression(
    property.value,
    expected,
    context.environment,
    context.path,
    context.issue,
  );
  return expression === null
    ? null
    : freeze({
        kind: 'typed-geometry-property',
        name: property.name,
        type: expected,
        expression,
        span: property.span,
      });
};

const compileOptionProperty = (
  statement: AssetGeometryBlock,
  property: AssetGeometryProperty,
  context: GeomExtraContext,
): Extract<TypedGeometryStatement, { readonly kind: 'typed-geometry-option' }> | null => {
  const isAxis = property.name === 'axis';
  const validHost = isAxis
    ? statement.keyword === 'taper' || statement.keyword === 'cylinder'
    : statement.keyword === 'wedge';
  if (!validHost) {
    context.issue(
      context.path,
      property.span,
      'asset.invalid-geometry-property',
      `Property "${property.name}" is not allowed on a ${statement.keyword}.`,
    );
    return null;
  }
  const allowed = isAxis ? ['x', 'y', 'z'] : ['north', 'south', 'east', 'west'];
  const val = property.value;
  if (val.kind !== 'name' || !allowed.includes(val.value)) {
    context.issue(
      context.path,
      val.span,
      'asset.invalid-geometry-property',
      `Property "${property.name}" must be one of ${allowed.join(', ')}.`,
    );
    return null;
  }
  return freeze({
    kind: 'typed-geometry-option',
    name: property.name as 'axis' | 'slope',
    value: val.value,
    span: property.span,
  });
};

const compileMirrorProperty = (
  statement: AssetGeometryBlock,
  property: AssetGeometryProperty,
  ownsSurface: boolean,
  context: GeomExtraContext,
): TypedGeometryMirrorBind | null => {
  if (!ownsSurface) {
    context.issue(
      context.path,
      property.span,
      'asset.invalid-geometry-property',
      'Property "mirror_x" is allowed only on geometric surface primitives.',
    );
    return null;
  }
  const value = property.value;
  if (value.kind !== 'name' || value.value.length === 0 || value.value === statement.id) {
    context.issue(
      context.path,
      value.span,
      'asset.invalid-mirror-target',
      'mirror_x must name a distinct sibling geometry node identifier.',
    );
    return null;
  }
  return freeze({ kind: 'typed-geometry-mirror', targetId: value.value, span: property.span });
};

const splitExprSurfaceRef = (
  val: AssetGeometryProperty['value'],
): readonly [string, string] | null => {
  if (val.kind === 'member' && val.object.kind === 'name') {
    return [val.object.value, val.member];
  }
  if (val.kind === 'name' && val.value.includes('.')) {
    const parts = val.value.split('.');
    if (parts.length === 2 && parts[0] && parts[1]) return [parts[0], parts[1]];
  }
  return null;
};

const compileExprVariant = (
  property: AssetGeometryProperty,
  context: GeomExtraContext,
): Extract<TypedGeometryStatement, { readonly kind: 'typed-geometry-expr-variant' }> | null => {
  const parts = splitExprSurfaceRef(property.value);
  if (parts === null) {
    context.issue(
      context.path,
      property.value.span,
      'asset.surface-chart-binding',
      `Expression variant "${property.name}" requires <surface_port>.<chart>.`,
    );
    return null;
  }
  const [portName, chart] = parts;
  if (!context.surfaceChart(portName, chart)) {
    context.issue(
      context.path,
      property.value.span,
      'asset.surface-chart-binding',
      `Expression variant "${property.name}" references unknown surface chart "${portName}.${chart}".`,
    );
    return null;
  }
  return freeze({
    kind: 'typed-geometry-expr-variant',
    variant: property.name,
    surfacePort: portName,
    chart,
    span: property.span,
  });
};

/** Compile one geometry property statement and record expression variant additions. */
export const compileGeometryPropertyEntry = (
  statement: AssetGeometryBlock,
  property: AssetGeometryProperty,
  schema: Readonly<Record<string, AssetExpectedType>>,
  ownsSurface: boolean,
  context: GeomExtraContext,
  typed: TypedGeometryStatement[],
): boolean => {
  if (property.name === 'mirror_x') {
    const mirrored = compileMirrorProperty(statement, property, ownsSurface, context);
    if (mirrored !== null) typed.push(mirrored);
    return false;
  }
  if (property.name === 'axis' || property.name === 'slope') {
    const opt = compileOptionProperty(statement, property, context);
    if (opt !== null) typed.push(opt);
    return false;
  }
  const expected = schema[property.name];
  if (expected === undefined && statement.keyword === 'expression_slot') {
    const variant = compileExprVariant(property, context);
    if (variant !== null) typed.push(variant);
    return variant !== null;
  }
  if (expected === undefined) {
    context.issue(
      context.path,
      property.span,
      'asset.invalid-geometry-property',
      `Property "${property.name}" is not allowed on a ${statement.keyword}.`,
    );
    return false;
  }
  const value = compileProperty(property, expected, context);
  if (value !== null) typed.push(value);
  return false;
};
