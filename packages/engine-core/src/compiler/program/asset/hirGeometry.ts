import type { AssetGeometryProperty } from '../../../project/program/asset/contract';
import type {
  AssetGeometryBlock,
  AssetGeometryPayload,
  AssetGeometryStatement,
  AssetGeometrySurfaceBind,
} from '../../../project/program/asset/contract';
import type { AssetExpressionTypeEnvironment, AssetExpectedType } from './value/contract';
import { compileHirExpression, type HirIssue } from './hirValues';
import type {
  TypedGeometryBlock,
  TypedGeometryPayload,
  TypedGeometryProperty,
  TypedGeometryStatement,
  TypedGeometrySurfaceBind,
} from './contract';

const freeze = <T>(value: T): T => Object.freeze(value);

export interface GeometryCompileContext {
  readonly path: string;
  readonly environment: AssetExpressionTypeEnvironment;
  readonly issue: HirIssue;
  readonly surfaceChart: (port: string, chart: string) => boolean;
}

type GeometryKind = AssetGeometryBlock['keyword'];
type Schema = Readonly<Record<string, AssetExpectedType>>;

const schemas: Readonly<Record<GeometryKind, Schema>> = Object.freeze({
  bone: Object.freeze({
    position: 'vec3<unit>',
    rotation: 'vec3<degree>',
    pivot: 'vec3<unit>',
    visible: 'bool',
  }),
  cube: Object.freeze({
    origin: 'vec3<unit>',
    size: 'vec3<unit>',
    position: 'vec3<unit>',
    rotation: 'vec3<degree>',
    pivot: 'vec3<unit>',
    visible: 'bool',
    inflate: 'unit',
    mirror: 'bool',
  }),
  plane: Object.freeze({
    origin: 'vec3<unit>',
    size: 'vec2<unit>',
    position: 'vec3<unit>',
    rotation: 'vec3<degree>',
    pivot: 'vec3<unit>',
    visible: 'bool',
    'u-axis': 'vec3<unit>',
    'v-axis': 'vec3<unit>',
  }),
  locator: Object.freeze({
    position: 'vec3<unit>',
    rotation: 'vec3<degree>',
    visible: 'bool',
  }),
  face: Object.freeze({ enabled: 'bool', rotation: 'integer' }),
});

const requiredFields: Readonly<Record<GeometryKind, readonly string[]>> = Object.freeze({
  bone: [],
  cube: ['origin', 'size'],
  plane: ['origin', 'size', 'u-axis', 'v-axis'],
  locator: [],
  face: [],
});

const faceDirections = new Set(['north', 'south', 'east', 'west', 'up', 'down']);

const propertyStatements = (
  statement: AssetGeometryBlock,
): readonly Extract<AssetGeometryStatement, { readonly kind: 'geometry-property' }>[] =>
  statement.statements.filter(
    (
      child,
    ): child is Extract<
      AssetGeometryStatement,
      {
        readonly kind: 'geometry-property';
      }
    > => child.kind === 'geometry-property',
  );

const compileProperty = (
  property: AssetGeometryProperty,
  expected: AssetExpectedType,
  context: GeometryCompileContext,
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

const compileSurface = (
  statement: AssetGeometrySurfaceBind,
  context: GeometryCompileContext,
): TypedGeometrySurfaceBind => {
  if (!context.surfaceChart(statement.surfacePort, statement.chart)) {
    context.issue(
      context.path,
      statement.span,
      'asset.surface-chart-binding',
      'Geometry chart binding must name a chart in a required surface contract.',
    );
  }
  return freeze({
    kind: 'typed-geometry-surface-bind',
    surfacePort: statement.surfacePort,
    chart: statement.chart,
    span: statement.span,
  });
};

const compileBlock = (
  statement: AssetGeometryBlock,
  context: GeometryCompileContext,
): TypedGeometryBlock => {
  const schema = schemas[statement.keyword];
  const properties = propertyStatements(statement);
  const names = new Set<string>();
  const typed: TypedGeometryStatement[] = [];
  for (const property of properties) {
    if (names.has(property.name))
      context.issue(
        context.path,
        property.span,
        'asset.duplicate-geometry-property',
        'Geometry property "' + property.name + '" is declared more than once.',
      );
    names.add(property.name);
    const expected = schema[property.name];
    if (expected === undefined) {
      context.issue(
        context.path,
        property.span,
        'asset.invalid-geometry-property',
        'Property "' + property.name + '" is not allowed on a ' + statement.keyword + '.',
      );
      continue;
    }
    const value = compileProperty(property, expected, context);
    if (value !== null) typed.push(value);
  }
  for (const required of requiredFields[statement.keyword]) {
    if (!names.has(required))
      context.issue(
        context.path,
        statement.span,
        'asset.missing-geometry-property',
        'A ' + statement.keyword + ' requires an explicit "' + required + '" property.',
      );
  }
  const surfaces = statement.statements.filter(
    (child): child is AssetGeometrySurfaceBind => child.kind === 'geometry-surface-bind',
  );
  if (surfaces.length > 0 && statement.keyword !== 'cube' && statement.keyword !== 'plane') {
    context.issue(
      context.path,
      surfaces[0]!.span,
      'asset.surface-chart-binding',
      'Only cube and plane nodes may own surface chart bindings.',
    );
  }
  if ((statement.keyword === 'cube' || statement.keyword === 'plane') && surfaces.length !== 1) {
    context.issue(
      context.path,
      statement.span,
      'asset.surface-chart-binding',
      'Every cube or plane requires exactly one typed surface chart binding.',
    );
  }
  for (const surface of surfaces) typed.push(compileSurface(surface, context));
  const childKinds =
    statement.keyword === 'bone'
      ? new Set(['bone', 'cube', 'plane', 'locator'])
      : statement.keyword === 'cube'
        ? new Set(['face'])
        : new Set<string>();
  const faceNames = new Set<string>();
  for (const child of statement.statements) {
    if (child.kind !== 'geometry-block') continue;
    if (!childKinds.has(child.keyword)) {
      context.issue(
        context.path,
        child.span,
        'asset.invalid-geometry-scope',
        statement.keyword === 'bone'
          ? 'Bones may contain only bone, cube, plane, or locator children.'
          : statement.keyword === 'cube'
            ? 'Cubes may contain only direct face children.'
            : 'Plane, locator, and face nodes cannot contain geometry children.',
      );
      continue;
    }
    if (statement.keyword === 'cube') {
      if (!faceDirections.has(child.id))
        context.issue(
          context.path,
          child.span,
          'asset.invalid-geometry-face',
          'Cube faces must use a canonical face direction.',
        );
      if (faceNames.has(child.id))
        context.issue(
          context.path,
          child.span,
          'asset.duplicate-geometry-face',
          'Cube face directions must be unique.',
        );
      faceNames.add(child.id);
    }
    typed.push(compileBlock(child, context));
  }
  return freeze({
    kind: 'typed-geometry-block',
    keyword: statement.keyword,
    id: statement.id,
    statements: freeze(typed),
    span: statement.span,
  });
};

export const compileGeometryPayload = (
  payload: AssetGeometryPayload,
  context: GeometryCompileContext,
): TypedGeometryPayload => {
  const statements: TypedGeometryStatement[] = [];
  for (const statement of payload.statements) {
    if (statement.kind === 'geometry-block') statements.push(compileBlock(statement, context));
    else if (statement.kind === 'geometry-surface-bind')
      context.issue(
        context.path,
        statement.span,
        'asset.surface-chart-binding',
        'A geometry surface binding must belong to a cube or plane node.',
      );
    else
      context.issue(
        context.path,
        statement.span,
        'asset.invalid-geometry-property',
        'Component geometry cannot contain root-level properties.',
      );
  }
  return freeze({ kind: 'typed-geometry', statements: freeze(statements), span: payload.span });
};
