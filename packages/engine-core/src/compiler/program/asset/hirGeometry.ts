import { freeze } from '../../../immutable';
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
  TypedGeometryMirrorBind,
  TypedGeometryPayload,
  TypedGeometryProperty,
  TypedGeometryStatement,
  TypedGeometrySurfaceBind,
} from './contract';

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
    u_axis: 'vec3<unit>',
    v_axis: 'vec3<unit>',
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
  plane: ['origin', 'size', 'u_axis', 'v_axis'],
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

interface ChildScope {
  readonly kinds: ReadonlySet<string>;
  readonly message: string;
}

const leafScope: ChildScope = Object.freeze({
  kinds: new Set<string>(),
  message: 'Plane, locator, and face nodes cannot contain geometry children.',
});

const childScopes: Readonly<Record<GeometryKind, ChildScope>> = Object.freeze({
  bone: {
    kinds: new Set(['bone', 'cube', 'plane', 'locator']),
    message: 'Bones may contain only bone, cube, plane, or locator children.',
  },
  cube: { kinds: new Set(['face']), message: 'Cubes may contain only direct face children.' },
  plane: leafScope,
  locator: leafScope,
  face: leafScope,
});

const ownsSurface = (keyword: GeometryKind): boolean => keyword === 'cube' || keyword === 'plane';

const compileMirrorProperty = (
  statement: AssetGeometryBlock,
  property: AssetGeometryProperty,
  context: GeometryCompileContext,
): TypedGeometryMirrorBind | null => {
  if (statement.keyword !== 'cube' && statement.keyword !== 'plane') {
    context.issue(
      context.path,
      property.span,
      'asset.invalid-geometry-property',
      'Property "mirror_x" is allowed only on cube and plane nodes.',
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

/** Compiles schema-checked properties into `typed`; returns every declared property name. */
const compileProperties = (
  statement: AssetGeometryBlock,
  context: GeometryCompileContext,
  typed: TypedGeometryStatement[],
): ReadonlySet<string> => {
  const schema = schemas[statement.keyword];
  const names = new Set<string>();
  for (const property of propertyStatements(statement)) {
    if (names.has(property.name))
      context.issue(
        context.path,
        property.span,
        'asset.duplicate-geometry-property',
        'Geometry property "' + property.name + '" is declared more than once.',
      );
    names.add(property.name);
    if (property.name === 'mirror_x') {
      const mirrored = compileMirrorProperty(statement, property, context);
      if (mirrored !== null) typed.push(mirrored);
      continue;
    }
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
  return names;
};

const checkRequiredProperties = (
  statement: AssetGeometryBlock,
  names: ReadonlySet<string>,
  context: GeometryCompileContext,
): void => {
  for (const required of requiredFields[statement.keyword]) {
    if (!names.has(required))
      context.issue(
        context.path,
        statement.span,
        'asset.missing-geometry-property',
        'A ' + statement.keyword + ' requires an explicit "' + required + '" property.',
      );
  }
};

const compileSurfaces = (
  statement: AssetGeometryBlock,
  context: GeometryCompileContext,
  typed: TypedGeometryStatement[],
): void => {
  const surfaces = statement.statements.filter(
    (child): child is AssetGeometrySurfaceBind => child.kind === 'geometry-surface-bind',
  );
  const owner = ownsSurface(statement.keyword);
  if (surfaces.length > 0 && !owner) {
    context.issue(
      context.path,
      surfaces[0]!.span,
      'asset.surface-chart-binding',
      'Only cube and plane nodes may own surface chart bindings.',
    );
  }
  if (owner && surfaces.length !== 1) {
    context.issue(
      context.path,
      statement.span,
      'asset.surface-chart-binding',
      'Every cube or plane requires exactly one typed surface chart binding.',
    );
  }
  for (const surface of surfaces) typed.push(compileSurface(surface, context));
};

const checkCubeFace = (
  face: AssetGeometryBlock,
  faceNames: Set<string>,
  context: GeometryCompileContext,
): void => {
  if (!faceDirections.has(face.id))
    context.issue(
      context.path,
      face.span,
      'asset.invalid-geometry-face',
      'Cube faces must use a canonical face direction.',
    );
  if (faceNames.has(face.id))
    context.issue(
      context.path,
      face.span,
      'asset.duplicate-geometry-face',
      'Cube face directions must be unique.',
    );
  faceNames.add(face.id);
};

const compileChildren = (
  statement: AssetGeometryBlock,
  context: GeometryCompileContext,
  typed: TypedGeometryStatement[],
): void => {
  const scope = childScopes[statement.keyword];
  const faceNames = new Set<string>();
  for (const child of statement.statements) {
    if (child.kind !== 'geometry-block') continue;
    if (!scope.kinds.has(child.keyword)) {
      context.issue(context.path, child.span, 'asset.invalid-geometry-scope', scope.message);
      continue;
    }
    if (statement.keyword === 'cube') checkCubeFace(child, faceNames, context);
    typed.push(compileBlock(child, context));
  }
};

const compileBlock = (
  statement: AssetGeometryBlock,
  context: GeometryCompileContext,
): TypedGeometryBlock => {
  const typed: TypedGeometryStatement[] = [];
  const names = compileProperties(statement, context, typed);
  checkRequiredProperties(statement, names, context);
  compileSurfaces(statement, context, typed);
  compileChildren(statement, context, typed);
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
