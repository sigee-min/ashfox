import { parseGeometryPayload, type AssetGeometryReader } from './geometry';
import { docsHint, formatDidYouMean } from '../../source/suggest';
import type {
  AssetComponentDecl,
  AssetComponentJointBind,
  AssetComponentParamDecl,
  AssetComponentSocketBind,
  AssetFrameDecl,
  AssetGeometryPayload,
  AssetGeometrySurfaceBind,
  AssetPortDecl,
} from './contract';
import {
  isOneOf,
  join,
  readBraced,
  readProperty,
  readUniqueFrame,
  valueName,
  type AssetReader,
  type Token,
} from './parserSupport';

const readGeometrySurfaceBinding = (reader: AssetReader): AssetGeometrySurfaceBind => {
  const start = reader.expectWord('surface', 'Expected surface.');
  reader.expect('=', 'Expected = in a surface chart binding.');
  const surfacePort = reader.id('Expected a surface port name.');
  reader.expect('.', 'Surface chart bindings require <surface-port>.<chart>.');
  const chart = reader.id('Expected a surface chart name.');
  reader.finish();
  return Object.freeze({
    kind: 'geometry-surface-bind',
    surfacePort: surfacePort.value,
    chart: chart.value,
    span: join(start.span, chart.span),
  });
};

const geometryReader = (reader: AssetReader): AssetGeometryReader => ({
  current: () => reader.current(),
  end: () => reader.end(),
  take: () => reader.take(),
  check: (value) => reader.check(value),
  checkWord: (value) => reader.checkWord(value),
  match: (value) => reader.match(value),
  expect: (value, message) => reader.expect(value, message),
  id: (message) => reader.id(message),
  assignment: () => reader.assignment(),
  expression: () => reader.expression(),
  property: () => {
    const value = readProperty(reader);
    return Object.freeze({
      kind: 'geometry-property',
      name: value.name,
      value: value.value,
      span: value.span,
    });
  },
  surfaceBinding: () => readGeometrySurfaceBinding(reader),
  fail: (code, message, token) => reader.fail(code, message, token),
  enterDepth: (token) => reader.enter(token),
  leaveDepth: () => reader.leave(),
  recover: () => reader.recover(),
});

const readPortCapacity = (
  reader: AssetReader,
  direction: AssetPortDecl['direction'],
  domain: AssetPortDecl['domain'],
  id: Token,
): { readonly capacity: AssetPortDecl['capacity']; readonly terminated: boolean } => {
  if (!reader.checkWord('capacity')) {
    if (domain === 'socket' && direction === 'provides') {
      reader.failSpan(
        'asset.missing-socket-capacity',
        'Provided socket ports require an explicit capacity = one|many declaration.',
        id.span,
      );
    }
    return { capacity: null, terminated: false };
  }
  const property = readProperty(reader);
  const raw = valueName(property.value);
  if (domain !== 'socket' || direction !== 'provides') {
    reader.failSpan(
      'asset.invalid-socket-capacity',
      'Only provided socket ports may declare capacity.',
      property.span,
    );
    return { capacity: null, terminated: true };
  }
  if (!isOneOf(['one', 'many'] as const, raw)) {
    reader.failSpan(
      'asset.invalid-socket-capacity',
      `Socket capacity must be one or many.${raw ? formatDidYouMean(raw, ['one', 'many']) : ''}`,
      property.value.span,
      docsHint('model'),
    );
    return { capacity: null, terminated: true };
  }
  return { capacity: raw, terminated: true };
};

const readPort = (reader: AssetReader, direction: AssetPortDecl['direction']): AssetPortDecl => {
  const start = reader.take();
  const domainToken = reader.id('Expected a port domain.');
  const domain = domainToken.value as AssetPortDecl['domain'];
  if (!isOneOf(['rig', 'surface', 'socket'] as const, domain)) {
    reader.fail(
      'asset.invalid-port-domain',
      `Port domain must be rig, surface, or socket.${formatDidYouMean(domain, ['rig', 'surface', 'socket'])}`,
      domainToken,
      docsHint('model'),
    );
  }
  const id = reader.id('Expected a port name.');
  reader.expect(':', 'Expected : and a port type.');
  const type = reader.qualified('Expected a port type name.');
  const { capacity, terminated } = readPortCapacity(reader, direction, domain, id);
  if (!terminated) reader.finish();
  return Object.freeze({
    kind: 'port',
    direction,
    domain,
    id: id.value,
    type,
    capacity,
    span: join(start.span, type.span),
  });
};

const readParamDecl = (reader: AssetReader): AssetComponentParamDecl => {
  const start = reader.expectWord('param', 'Expected param in component parameter declaration.');
  const id = reader.id('Expected a component parameter name.');
  reader.expect(':', 'Component parameters require a closed type.');
  const type = reader.valueType();
  const defaultValue = reader.match('=') ? reader.expression() : null;
  return Object.freeze({
    kind: 'component-param',
    id: id.value,
    type,
    defaultValue,
    span: join(start.span, defaultValue?.span ?? id.span),
  });
};

const readComponentParam = (reader: AssetReader): AssetComponentParamDecl => {
  const param = readParamDecl(reader);
  reader.finish();
  return param;
};

const readHeaderParams = (reader: AssetReader, state: ComponentState): void => {
  if (!reader.match('(')) return;
  while (!reader.check(')') && !reader.end()) {
    state.parameters.push(readParamDecl(reader));
    if (!reader.match(',')) break;
  }
  reader.expect(')', 'Expected ) to close component parameter list.');
};

const readComponentJointBind = (reader: AssetReader): AssetComponentJointBind => {
  const start = reader.expectWord('bind', 'Expected bind.');
  reader.expectWord('bone', 'Component bindings use bind bone <geometry-name> to <rig-joint>.');
  const geometryBone = reader.id('Expected a geometry bone name.');
  reader.expectWord('to', 'Expected to in a component joint binding.');
  const rigJoint = reader.qualified('Expected a rig joint name.');
  reader.finish();
  return Object.freeze({
    kind: 'component-joint-bind',
    geometryBone: geometryBone.value,
    rigJoint,
    span: join(start.span, rigJoint.span),
  });
};

const readComponentSocketBind = (reader: AssetReader): AssetComponentSocketBind => {
  const start = reader.expectWord('bind', 'Expected bind.');
  reader.expectWord('socket', 'Expected socket after bind.');
  const port = reader.id('Expected a socket port name.');
  reader.expectWord('to', 'Expected to in a component socket binding.');
  reader.expectWord('bone', 'Component socket bindings target a geometry bone.');
  const geometryBone = reader.id('Expected a geometry bone name.');
  let frame: AssetFrameDecl | null = null;
  const close = readBraced(
    reader,
    'Expected { to begin a component socket binding.',
    'Expected } to close a component socket binding.',
    () => {
      if (reader.checkWord('frame')) frame = readUniqueFrame(reader, frame);
      else reader.scopeError('component socket binding');
    },
  );
  return Object.freeze({
    kind: 'component-socket-bind',
    port: port.value,
    geometryBone: geometryBone.value,
    frame,
    span: join(start.span, close.span),
  });
};

interface ComponentState {
  readonly parameters: AssetComponentParamDecl[];
  readonly ports: AssetPortDecl[];
  readonly jointBindings: AssetComponentJointBind[];
  readonly socketBindings: AssetComponentSocketBind[];
  geometry: AssetGeometryPayload | null;
}

const readComponentEntry = (reader: AssetReader, state: ComponentState): void => {
  if (reader.checkWord('param')) state.parameters.push(readComponentParam(reader));
  else if (reader.checkWord('requires')) state.ports.push(readPort(reader, 'requires'));
  else if (reader.checkWord('provides')) state.ports.push(readPort(reader, 'provides'));
  else if (reader.checkWord('bind')) {
    if (reader.nextIsWord('socket')) state.socketBindings.push(readComponentSocketBind(reader));
    else state.jointBindings.push(readComponentJointBind(reader));
  } else if (reader.checkWord('geometry')) {
    const geometryStart = reader.take();
    state.geometry = parseGeometryPayload(geometryReader(reader), geometryStart);
  } else reader.scopeError('component');
};

export const parseComponent = (reader: AssetReader, exported: boolean): AssetComponentDecl => {
  const start = reader.expectWord('component', 'Expected component.');
  const id = reader.id('Expected component name.');
  const state: ComponentState = {
    parameters: [],
    ports: [],
    jointBindings: [],
    socketBindings: [],
    geometry: null,
  };
  readHeaderParams(reader, state);
  const close = readBraced(
    reader,
    'Expected { to begin a component.',
    'Expected } to close a component.',
    () => readComponentEntry(reader, state),
  );
  return Object.freeze({
    kind: 'component',
    exported,
    id: id.value,
    parameters: Object.freeze(state.parameters),
    ports: Object.freeze(state.ports),
    jointBindings: Object.freeze(state.jointBindings),
    socketBindings: Object.freeze(state.socketBindings),
    geometry:
      state.geometry ??
      Object.freeze({ kind: 'geometry', statements: Object.freeze([]), span: close.span }),
    span: join(start.span, close.span),
  });
};
