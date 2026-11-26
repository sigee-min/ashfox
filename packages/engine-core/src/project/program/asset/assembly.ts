import type { SourceSpan } from '../../source/contract';
import type {
  AssetAssemblyConnect,
  AssetAssemblyDecl,
  AssetAssemblyUse,
  AssetParamSetDecl,
  AssetQualifiedName,
  AssetSettingsDecl,
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
  const endSpan = reader.match(';') ? reader.prevSpan() : close.span;
  return Object.freeze({
    kind: 'use',
    component,
    id,
    parameterSets: Object.freeze(parameterSets),
    portBindings: Object.freeze([]),
    span: join(start.span, endSpan),
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
