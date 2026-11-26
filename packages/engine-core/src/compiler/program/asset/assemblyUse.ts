import { freeze } from '../../../immutable';
import type {
  AssetAssemblyUse,
  AssetParamSetDecl,
  AssetPortBindingDecl,
  AssetQualifiedName,
} from '../../../project/program/asset/contract';
import type { ProgramExpr } from '../../../project/program/syntax/contract';
import { nullRecord } from './diagnostics';
import type { AssetValue } from './value/contract';
import {
  type AssetSymbolId,
  type AssetSymbolKind,
  type TypedAssetUse,
  type TypedComponent,
  type TypedSkeleton,
  type TypedSurface,
} from './contract';
import { compileAndEvaluateHirExpression, type HirIssue } from './hirValues';

export type AssemblyInstance = Readonly<{
  readonly use: AssetAssemblyUse;
  readonly component: TypedComponent;
}>;

export interface UseBuildContext<S extends { readonly path: string }> {
  readonly issue: HirIssue;
  readonly resolve: (
    state: S,
    name: AssetQualifiedName,
    expected?: AssetSymbolKind,
  ) => { readonly symbol: AssetSymbolId } | null;
}

const bindingKind = (port: TypedComponent['ports'][number]): AssetSymbolKind =>
  port.domain === 'rig' ? 'rig-contract' : 'surface';

const buildUseParameters = <S extends { readonly path: string }>(
  context: UseBuildContext<S>,
  state: S,
  use: AssetAssemblyUse,
  component: TypedComponent,
): Readonly<Record<string, AssetValue>> => {
  const parameters = nullRecord<AssetValue>();
  const sets = new Map<string, AssetAssemblyUse['parameterSets'][number]>();
  for (const set of use.parameterSets) {
    if (sets.has(set.id)) {
      context.issue(
        state.path,
        set.span,
        'asset.duplicate-parameter-set',
        'Component parameter "' + set.id + '" is set more than once.',
      );
    }
    sets.set(set.id, set);
    const type = component.parameters[set.id];
    if (type === undefined) {
      context.issue(
        state.path,
        set.span,
        'asset.unknown-parameter',
        'Component use sets an undeclared parameter "' + set.id + '".',
      );
      continue;
    }
    const value = compileAndEvaluateHirExpression(
      set.value,
      type,
      new Map(),
      new Map(),
      state.path,
      context.issue,
    );
    if (value !== null) parameters[set.id] = value;
  }
  for (const id of Object.keys(component.parameters)) {
    if (!sets.has(id)) {
      context.issue(
        state.path,
        use.span,
        'asset.missing-parameter',
        'Component parameter "' + id + '" must be set exactly once.',
      );
    }
  }
  return freeze(parameters);
};

const resolveUsePortBinding = <S extends { readonly path: string }>(
  context: UseBuildContext<S>,
  state: S,
  binding: AssetAssemblyUse['portBindings'][number],
  component: TypedComponent,
  skeleton: TypedSkeleton,
  surfaces: Readonly<Record<string, TypedSurface>>,
): AssetSymbolId | null => {
  const port = component.ports.find((candidate) => candidate.id === binding.port);
  if (port === undefined) {
    context.issue(
      state.path,
      binding.span,
      'asset.unknown-port-binding',
      'Component binding names an undeclared port "' + binding.port + '".',
    );
    return null;
  }
  if (port.domain === 'socket') {
    context.issue(
      state.path,
      binding.span,
      'asset.socket-port-binding',
      'Socket ports are bound only by connect provider -> required statements.',
    );
    return null;
  }
  if (port.direction !== 'requires') {
    context.issue(
      state.path,
      binding.span,
      'asset.provided-port-binding',
      'Provided component ports cannot be bound by an assembly use.',
    );
    return null;
  }
  const target = context.resolve(state, binding.target, bindingKind(port));
  if (target === null) return null;
  if (port.domain === 'rig') {
    if (target.symbol.key === skeleton.rig.key) return target.symbol;
    context.issue(
      state.path,
      binding.span,
      'asset.port-binding-mismatch',
      'A component rig port must bind the selected skeleton rig.',
    );
    return null;
  }
  const surface = surfaces[target.symbol.key];
  if (surface !== undefined && surface.contract.key === port.type.key) return target.symbol;
  context.issue(
    state.path,
    binding.span,
    'asset.port-binding-mismatch',
    'A component surface port must bind a concrete surface implementing its nominal contract.',
  );
  return null;
};

const buildUsePortBindings = <S extends { readonly path: string }>(
  context: UseBuildContext<S>,
  state: S,
  use: AssetAssemblyUse,
  component: TypedComponent,
  skeleton: TypedSkeleton,
  surfaces: Readonly<Record<string, TypedSurface>>,
): Readonly<Record<string, AssetSymbolId>> => {
  const bindings = new Map<string, AssetAssemblyUse['portBindings'][number]>();
  const portBindings = nullRecord<AssetSymbolId>();
  for (const binding of use.portBindings) {
    if (bindings.has(binding.port)) {
      context.issue(
        state.path,
        binding.span,
        'asset.duplicate-port-binding',
        'Component port "' + binding.port + '" is bound more than once.',
      );
    }
    bindings.set(binding.port, binding);
    const symbol = resolveUsePortBinding(context, state, binding, component, skeleton, surfaces);
    if (symbol !== null) portBindings[binding.port] = symbol;
  }
  for (const port of component.ports) {
    if (port.direction === 'requires' && port.domain !== 'socket' && !bindings.has(port.id)) {
      context.issue(
        state.path,
        use.span,
        'asset.missing-port-binding',
        'Required component port "' + port.id + '" must be bound by the assembly.',
      );
    }
  }
  return freeze(portBindings);
};

const qualifiedTarget = (expr: ProgramExpr): AssetQualifiedName | null => {
  if (expr.kind === 'name') {
    return freeze({
      kind: 'qualified-name',
      segments: freeze(expr.value.split('.')),
      span: expr.span,
    });
  }
  if (expr.kind === 'member' && expr.object.kind === 'name') {
    return freeze({
      kind: 'qualified-name',
      segments: freeze([...expr.object.value.split('.'), expr.member]),
      span: expr.span,
    });
  }
  return null;
};

const splitUseEntries = <S extends { readonly path: string }>(
  context: UseBuildContext<S>,
  state: S,
  use: AssetAssemblyUse,
  component: TypedComponent,
): Readonly<{
  readonly parameterSets: readonly AssetParamSetDecl[];
  readonly portBindings: readonly AssetPortBindingDecl[];
}> => {
  const portNames = new Set(component.ports.map((port) => port.id));
  const parameterSets: AssetParamSetDecl[] = [];
  const portBindings: AssetPortBindingDecl[] = [...use.portBindings];
  for (const entry of use.parameterSets) {
    if (!portNames.has(entry.id)) {
      parameterSets.push(entry);
      continue;
    }
    const target = qualifiedTarget(entry.value);
    if (target === null) {
      context.issue(
        state.path,
        entry.value.span,
        'asset.invalid-port-binding',
        'Component port binding "' + entry.id + '" requires a qualified symbol.',
      );
      continue;
    }
    portBindings.push(freeze({ kind: 'port-binding', port: entry.id, target, span: entry.span }));
  }
  return { parameterSets: freeze(parameterSets), portBindings: freeze(portBindings) };
};

export const buildUse = <S extends { readonly path: string }>(
  context: UseBuildContext<S>,
  state: S,
  use: AssetAssemblyUse,
  component: TypedComponent,
  skeleton: TypedSkeleton,
  surfaces: Readonly<Record<string, TypedSurface>>,
  instances: Map<string, AssemblyInstance>,
): TypedAssetUse => {
  if (instances.has(use.id)) {
    context.issue(
      state.path,
      use.span,
      'asset.duplicate-instance',
      'Component instance "' + use.id + '" is declared more than once.',
    );
  }
  const resolved = splitUseEntries(context, state, use, component);
  const normalizedUse: AssetAssemblyUse = freeze({ ...use, ...resolved });
  const typed: TypedAssetUse = freeze({
    component: component.symbol,
    id: use.id,
    parameters: buildUseParameters(context, state, normalizedUse, component),
    portBindings: buildUsePortBindings(
      context,
      state,
      normalizedUse,
      component,
      skeleton,
      surfaces,
    ),
    span: use.span,
  });
  instances.set(use.id, { use: normalizedUse, component });
  return typed;
};
