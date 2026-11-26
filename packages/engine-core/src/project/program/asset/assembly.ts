import type { SourceSpan } from '../../source/contract';
import type {
  AssetAssemblyConnect,
  AssetAssemblyDecl,
  AssetAssemblyUse,
  AssetKeyframeDecl,
  AssetMotionDecl,
  AssetParamSetDecl,
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
      'Rig motion only supports rest-space relative rotation and scale tracks; position and IK are forbidden.',
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

const readAssemblyUse = (reader: AssetReader): AssetAssemblyUse => {
  const start = reader.expectWord('use', 'Expected use.');
  const component = reader.qualified('Expected component name.');
  const id = reader.checkWord('as')
    ? (reader.take(), reader.id('Expected component instance name.').value)
    : component.segments[component.segments.length - 1]!;
  const parameterSets: AssetParamSetDecl[] = [];
  const close = readBraced(
    reader,
    'Expected { to begin component bindings.',
    'Expected } to close component bindings.',
    () => {
      if (reader.assignment()) {
        const property = readProperty(reader);
        parameterSets.push(
          Object.freeze({
            kind: 'param-set',
            id: property.name,
            value: property.value,
            span: property.span,
          }),
        );
      } else reader.scopeError('asset component use');
    },
  );
  return Object.freeze({
    kind: 'use',
    component,
    id,
    parameterSets: Object.freeze(parameterSets),
    portBindings: Object.freeze([]),
    span: join(start.span, close.span),
  });
};

const readConnect = (reader: AssetReader): AssetAssemblyConnect => {
  const start = reader.expectWord('connect', 'Expected connect.');
  const from = reader.qualified('Expected a source socket path.');
  reader.expect('->', 'Expected -> in a socket connection.');
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

export interface AssemblyState {
  settings: AssetSettingsDecl | null;
  settingsSeen: boolean;
  skeleton: AssetQualifiedName | null;
  skeletonSeen: boolean;
  motionsSeen: boolean;
  readonly motions: AssetQualifiedName[];
  readonly uses: AssetAssemblyUse[];
  readonly connections: AssetAssemblyConnect[];
}

export const createAssemblyState = (): AssemblyState => ({
  settings: null,
  settingsSeen: false,
  skeleton: null,
  skeletonSeen: false,
  motionsSeen: false,
  motions: [],
  uses: [],
  connections: [],
});

const readMotionsAssignment = (reader: AssetReader): readonly AssetQualifiedName[] => {
  reader.expectWord('motions', 'Expected motions.');
  reader.expect('=', 'Expected = after motions.');
  reader.expect('[', 'Expected [ to begin motions list.');
  const motions: AssetQualifiedName[] = [];
  while (!reader.check(']') && !reader.end()) {
    motions.push(reader.qualified('Expected motion name.'));
    if (!reader.match(',')) break;
  }
  reader.expect(']', 'Expected ] to close motions list.');
  reader.finish();
  return Object.freeze(motions);
};

export const readAssemblyEntry = (reader: AssetReader, state: AssemblyState): void => {
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
  } else if (reader.checkWord('motions')) {
    if (state.motionsSeen) {
      reader.failSpan(
        'asset.duplicate-motions',
        'An asset may contain only one motions list.',
        reader.current().span,
      );
    }
    state.motionsSeen = true;
    state.motions.push(...readMotionsAssignment(reader));
  } else if (reader.checkWord('use')) state.uses.push(readAssemblyUse(reader));
  else if (reader.checkWord('connect')) state.connections.push(readConnect(reader));
  else reader.scopeError('model');
};

export const buildAssemblyDecl = (
  id: string,
  exported: boolean,
  state: AssemblyState,
  span: SourceSpan,
): AssetAssemblyDecl =>
  Object.freeze({
    kind: 'asset',
    exported,
    id,
    settings: state.settings,
    skeleton: state.skeleton,
    motions: Object.freeze(state.motions),
    uses: Object.freeze(state.uses),
    connections: Object.freeze(state.connections),
    span,
  });
