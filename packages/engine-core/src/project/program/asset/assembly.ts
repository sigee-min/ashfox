import type {
  AssetAssemblyConnect,
  AssetAssemblyDecl,
  AssetAssemblyUse,
  AssetKeyframeDecl,
  AssetMotionDecl,
  AssetParamSetDecl,
  AssetPortBindingDecl,
  AssetPropertyDecl,
  AssetQualifiedName,
  AssetSettingsDecl,
  AssetTrackDecl,
} from './contract';
import {
  checkClosedProperties,
  isOneOf,
  join,
  nameOr,
  propertyValue,
  readBraced,
  readNamedAssignment,
  readProperties,
  readProperty,
  type AssetReader,
} from './parserSupport';

const readKeyframe = (reader: AssetReader): AssetKeyframeDecl => {
  const keyStart = reader.expectWord('key', 'Tracks contain key declarations.');
  const time = reader.expression();
  reader.expect('=', 'Expected = in a key declaration.');
  const value = reader.expression();
  let interpolation: AssetKeyframeDecl['interpolation'] = 'linear';
  const current = reader.current();
  if (
    current.kind === 'identifier' &&
    isOneOf(['linear', 'step', 'catmullrom'] as const, current.value)
  ) {
    interpolation = reader.take().value as AssetKeyframeDecl['interpolation'];
  } else {
    reader.failSpan(
      'asset.missing-interpolation',
      'Every motion key must declare linear, step, or catmullrom explicitly.',
      value.span,
    );
  }
  reader.finish();
  return Object.freeze({
    kind: 'keyframe',
    time,
    value,
    interpolation,
    span: join(keyStart.span, value.span),
  });
};

const readTrack = (reader: AssetReader): AssetTrackDecl => {
  const start = reader.expectWord('track', 'Expected track.');
  const parts = [reader.id('Expected a track target.').value];
  while (reader.match('/')) parts.push(reader.id('Expected a target path segment.').value);
  reader.expect('.', 'Tracks require .position, .rotation, .scale, or .ik.');
  const propertyToken = reader.id('Expected a track property.');
  const property = propertyToken.value as AssetTrackDecl['property'];
  if (property !== 'rotation' && property !== 'scale') {
    reader.fail(
      'asset.invalid-motion-property',
      'Rig motion only supports rest-relative rotation and scale tracks; position and IK are forbidden.',
      propertyToken,
    );
  }
  const keyframes: AssetKeyframeDecl[] = [];
  const close = readBraced(
    reader,
    'Expected { to begin a track.',
    'Expected } to close a track.',
    () => {
      keyframes.push(readKeyframe(reader));
    },
  );
  return Object.freeze({
    kind: 'track',
    target: parts.join('/'),
    property: property === 'scale' ? 'scale' : 'rotation',
    keyframes: Object.freeze(keyframes),
    span: join(start.span, close.span),
  });
};

export const parseMotion = (reader: AssetReader, exported: boolean): AssetMotionDecl => {
  const start = reader.expectWord('motion', 'Expected motion.');
  const id = reader.id('Expected motion name.');
  reader.expectWord('for', 'Motion requires for <rig-contract>.');
  const rig = reader.qualified('Expected rig contract name.');
  const properties: AssetPropertyDecl[] = [];
  const tracks: AssetTrackDecl[] = [];
  const close = readBraced(
    reader,
    'Expected { to begin a motion.',
    'Expected } to close a motion.',
    () => {
      if (reader.checkWord('track')) tracks.push(readTrack(reader));
      else if (reader.assignment()) properties.push(readProperty(reader));
      else reader.scopeError('motion');
    },
  );
  return Object.freeze({
    kind: 'motion',
    exported,
    id: id.value,
    rig,
    properties: Object.freeze(properties),
    tracks: Object.freeze(tracks),
    span: join(start.span, close.span),
  });
};

const readParameterSet = (reader: AssetReader): AssetParamSetDecl => {
  const start = reader.expectWord('set', 'Expected set.');
  const id = reader.id('Expected a component parameter name.');
  reader.expect('=', 'Expected = in a parameter assignment.');
  const value = reader.expression();
  reader.finish();
  return Object.freeze({
    kind: 'param-set',
    id: id.value,
    value,
    span: join(start.span, value.span),
  });
};

const readPortBinding = (reader: AssetReader): AssetPortBindingDecl => {
  const start = reader.expectWord('bind', 'Expected bind.');
  const port = reader.id('Expected a component port name.');
  reader.expect('=', 'Expected = in a component port binding.');
  const target = reader.qualified('Expected a qualified concrete component port target.');
  reader.finish();
  return Object.freeze({
    kind: 'port-binding',
    port: port.value,
    target,
    span: join(start.span, target.span),
  });
};

const readAssemblyUse = (reader: AssetReader): AssetAssemblyUse => {
  const start = reader.expectWord('use', 'Expected use.');
  const component = reader.qualified('Expected component name.');
  reader.expectWord('as', 'Expected as after component name.');
  const id = reader.id('Expected component instance name.');
  const parameterSets: AssetParamSetDecl[] = [];
  const portBindings: AssetPortBindingDecl[] = [];
  const close = readBraced(
    reader,
    'Expected { to begin component bindings.',
    'Expected } to close component bindings.',
    () => {
      if (reader.checkWord('set')) parameterSets.push(readParameterSet(reader));
      else if (reader.checkWord('bind')) portBindings.push(readPortBinding(reader));
      else reader.scopeError('asset component use');
    },
  );
  reader.finish();
  return Object.freeze({
    kind: 'use',
    component,
    id: id.value,
    parameterSets: Object.freeze(parameterSets),
    portBindings: Object.freeze(portBindings),
    span: join(start.span, close.span),
  });
};

const readConnect = (reader: AssetReader): AssetAssemblyConnect => {
  const start = reader.expectWord('connect', 'Expected connect.');
  const from = reader.qualified('Expected a source socket path.');
  reader.expect('-', 'Expected -> in a socket connection.');
  reader.expect('>', 'Expected -> in a socket connection.');
  const to = reader.qualified('Expected a target socket path.');
  reader.finish();
  return Object.freeze({
    kind: 'connect',
    from,
    to,
    span: join(start.span, to.span),
  });
};

const readProfileSetting = (
  reader: AssetReader,
  values: ReturnType<typeof readProperties>,
): AssetSettingsDecl['profile'] => {
  const expr = propertyValue(values, 'profile');
  if (expr === undefined) return null;
  const raw = nameOr(expr, '');
  if (isOneOf(['creature', 'prop', 'block'] as const, raw)) return raw;
  reader.failSpan(
    'asset.invalid-profile',
    'Asset settings profile must be creature|prop|block.',
    expr.span,
  );
  return null;
};

const readSettings = (reader: AssetReader): AssetSettingsDecl => {
  const start = reader.expectWord('settings', 'Expected settings.');
  const values = readProperties(reader, 'asset settings');
  checkClosedProperties(reader, values, ['density', 'forward', 'profile'], 'asset settings');
  const density = propertyValue(values, 'density') ?? null;
  const forwardRaw = nameOr(propertyValue(values, 'forward'), '');
  const forward = isOneOf(['north', 'south', 'east', 'west'] as const, forwardRaw)
    ? forwardRaw
    : null;
  if (forward === null) {
    reader.failSpan(
      'asset.invalid-forward',
      'Asset settings require forward = north|south|east|west.',
      start.span,
    );
  }
  const profile = readProfileSetting(reader, values);
  return Object.freeze({
    kind: 'settings',
    density,
    forward,
    profile,
    span: join(start.span, reader.blockEnd()),
  });
};

interface AssemblyState {
  settings: AssetSettingsDecl | null;
  settingsSeen: boolean;
  skeleton: AssetQualifiedName | null;
  skeletonSeen: boolean;
  readonly motions: AssetQualifiedName[];
  readonly uses: AssetAssemblyUse[];
  readonly connections: AssetAssemblyConnect[];
}

const readAssemblyEntry = (reader: AssetReader, state: AssemblyState): void => {
  if (reader.checkWord('settings')) {
    if (state.settingsSeen) {
      reader.failSpan(
        'asset.duplicate-settings',
        'An asset may contain only one settings block.',
        reader.current().span,
      );
    }
    state.settingsSeen = true;
    state.settings = readSettings(reader);
  } else if (reader.checkWord('skeleton')) {
    if (state.skeletonSeen) {
      reader.failSpan(
        'asset.duplicate-skeleton',
        'An asset may contain only one skeleton binding.',
        reader.current().span,
      );
    }
    state.skeletonSeen = true;
    state.skeleton = readNamedAssignment(reader, 'skeleton');
  } else if (reader.checkWord('motion')) state.motions.push(readNamedAssignment(reader, 'motion'));
  else if (reader.checkWord('use')) state.uses.push(readAssemblyUse(reader));
  else if (reader.checkWord('connect')) state.connections.push(readConnect(reader));
  else reader.scopeError('asset assembly');
};

export const parseAssembly = (reader: AssetReader, exported: boolean): AssetAssemblyDecl => {
  const start = reader.expectWord('asset', 'Expected asset.');
  const id = reader.id('Expected asset name.');
  const state: AssemblyState = {
    settings: null,
    settingsSeen: false,
    skeleton: null,
    skeletonSeen: false,
    motions: [],
    uses: [],
    connections: [],
  };
  const close = readBraced(
    reader,
    'Expected { to begin an asset assembly.',
    'Expected } to close an asset assembly.',
    () => readAssemblyEntry(reader, state),
  );
  return Object.freeze({
    kind: 'asset',
    exported,
    id: id.value,
    settings: state.settings,
    skeleton: state.skeleton,
    motions: Object.freeze(state.motions),
    uses: Object.freeze(state.uses),
    connections: Object.freeze(state.connections),
    span: join(start.span, close.span),
  });
};
