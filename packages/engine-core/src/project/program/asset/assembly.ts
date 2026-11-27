import type { SourceSpan } from '../../source/contract';
import { docsHint, formatDidYouMean } from '../../source/suggest';
import type {
  AssetAssemblyConnect,
  AssetAssemblyDecl,
  AssetAssemblyUse,
  AssetParamSetDecl,
  AssetQualifiedName,
  AssetSettingsDecl,
  AssetVariantDecl,
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

const readUseCallArgs = (reader: AssetReader, parameterSets: AssetParamSetDecl[]): void => {
  if (!reader.match('(')) return;
  while (!reader.check(')') && !reader.end()) {
    const id = reader.id('Expected parameter name.');
    reader.expect('=', 'Expected = after parameter name.');
    const value = reader.expression();
    parameterSets.push(
      Object.freeze({
        kind: 'param-set',
        id: id.value,
        value,
        span: join(id.span, value.span),
      }),
    );
    if (!reader.match(',')) break;
  }
  reader.expect(')', 'Expected ) to close component arguments.');
};

const readAssemblyUse = (reader: AssetReader): AssetAssemblyUse => {
  const start = reader.expectWord('use', 'Expected use.');
  const component = reader.qualified('Expected component name.');
  const parameterSets: AssetParamSetDecl[] = [];
  readUseCallArgs(reader, parameterSets);
  const id = reader.checkWord('as')
    ? (reader.take(), reader.id('Expected component instance name.').value)
    : component.segments[component.segments.length - 1]!;
  let endSpan = reader.prevSpan();
  if (reader.check('{')) {
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
    endSpan = reader.match(';') ? reader.prevSpan() : close.span;
  } else {
    reader.finish();
    endSpan = reader.prevSpan();
  }
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
    `Asset settings profile must be creature|prop|block.${raw ? formatDidYouMean(raw, ['creature', 'prop', 'block']) : ''}`,
    expr.span,
    docsHint('model'),
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
      `Asset settings require forward = north|south|east|west.${forwardRaw ? formatDidYouMean(forwardRaw, ['north', 'south', 'east', 'west']) : ''}`,
      propertyValue(values, 'forward')?.span ?? start.span,
      docsHint('model'),
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
  readonly variants: AssetVariantDecl[];
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
  variants: [],
});

const readVariant = (reader: AssetReader): AssetVariantDecl => {
  const start = reader.expectWord('variant', 'Expected variant.');
  const id = reader.id('Expected variant name.');
  const properties = readProperties(reader, 'asset variant');
  const seen = new Set<string>();
  for (const prop of properties) {
    if (seen.has(prop.name)) {
      reader.failSpan(
        'asset.duplicate-property',
        `Property "${prop.name}" is declared more than once in variant "${id.value}".`,
        prop.span,
      );
    }
    seen.add(prop.name);
  }
  return Object.freeze({
    kind: 'variant',
    id: id.value,
    properties: Object.freeze(properties),
    span: join(start.span, reader.blockEnd()),
  });
};

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
  else if (reader.checkWord('variant')) {
    const variant = readVariant(reader);
    if (state.variants.some((existing) => existing.id === variant.id)) {
      reader.failSpan(
        'asset.duplicate-variant',
        `Variant "${variant.id}" is declared more than once.`,
        variant.span,
      );
    }
    state.variants.push(variant);
  } else reader.scopeError('model');
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
    ...(state.variants.length > 0 ? { variants: Object.freeze(state.variants) } : {}),
    span,
  });
