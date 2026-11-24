import { freeze } from '../../../immutable';
import type {
  AssetSurfaceContractDecl,
  AssetSurfaceDecl,
  AssetValueType,
} from '../../../project/program/asset/contract';
import type { AssetValue } from './value/contract';
import {
  type AssetTexelValue,
  type AssetUnloweredTextureSource,
  type TypedChartAbi,
  type TypedSurface,
  type TypedSurfaceContract,
} from './contract';
import type { AssemblyContext, AssemblyEntry, AssemblyState } from './assembly';
import { compileAndEvaluateHirExpression } from './hirValues';
import { validateConcreteSurfaceCharts } from './surface';

const record = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;

const texel = (
  expression: Parameters<typeof compileAndEvaluateHirExpression>[0] | null,
  path: string,
  owner: Parameters<AssemblyContext['issue']>[1],
  issue: AssemblyContext['issue'],
): AssetTexelValue | null => {
  if (expression === null) {
    issue(path, owner, 'asset.missing-size', 'An explicit integral texel size is required.');
    return null;
  }
  const value = compileAndEvaluateHirExpression(
    expression,
    'texel',
    new Map(),
    new Map(),
    path,
    issue,
  );
  if (
    value?.kind !== 'number' ||
    value.type !== 'texel' ||
    value.value.denominator !== 1n ||
    value.value.numerator <= 0n
  ) {
    issue(
      path,
      expression.span,
      'asset.invalid-size',
      'Atlas and chart dimensions require positive integral texel values.',
    );
    return null;
  }
  return value as AssetTexelValue;
};

const buildSurfaceContractCharts = (
  context: AssemblyContext,
  state: AssemblyState,
  declaration: AssetSurfaceContractDecl,
): Readonly<Record<string, TypedChartAbi>> => {
  const charts = record<TypedChartAbi>();
  for (const chart of declaration.charts) {
    if (charts[chart.id] !== undefined) {
      context.issue(
        state.path,
        chart.span,
        'asset.duplicate-chart',
        `Surface chart "${chart.id}" is declared more than once.`,
      );
    }
    const chartWidth = texel(chart.width, state.path, chart.span, context.issue);
    const chartHeight = texel(chart.height, state.path, chart.span, context.issue);
    if (chart.coverage === null) {
      context.issue(
        state.path,
        chart.span,
        'asset.missing-coverage',
        'Surface charts require an explicit coverage policy.',
      );
    }
    if (chartWidth !== null && chartHeight !== null && chart.coverage !== null) {
      charts[chart.id] = freeze({
        id: chart.id,
        layout: chart.layout,
        width: chartWidth,
        height: chartHeight,
        coverage: chart.coverage,
        span: chart.span,
      });
    }
  }
  return freeze(charts);
};

const buildSurfaceContractSlots = (
  context: AssemblyContext,
  state: AssemblyState,
  declaration: AssetSurfaceContractDecl,
): Readonly<Record<string, AssetValueType>> => {
  const slots = record<AssetValueType>();
  for (const slot of declaration.slots) {
    if (slots[slot.id] !== undefined) {
      context.issue(
        state.path,
        slot.span,
        'asset.duplicate-slot',
        `Surface slot "${slot.id}" is declared more than once.`,
      );
    }
    slots[slot.id] = slot.type;
  }
  return freeze(slots);
};

export const buildSurfaceContract = (
  context: AssemblyContext,
  state: AssemblyState,
  entry: AssemblyEntry,
): TypedSurfaceContract | null => {
  const declaration = entry.declaration as AssetSurfaceContractDecl;
  const width = texel(
    declaration.atlas?.width ?? null,
    state.path,
    declaration.atlas?.span ?? declaration.span,
    context.issue,
  );
  const height = texel(
    declaration.atlas?.height ?? null,
    state.path,
    declaration.atlas?.span ?? declaration.span,
    context.issue,
  );
  if (declaration.atlas === null) {
    context.issue(
      state.path,
      declaration.span,
      'asset.missing-atlas',
      'Surface contracts require one explicit atlas.',
    );
  }
  if (declaration.material === null) {
    context.issue(
      state.path,
      declaration.span,
      'asset.missing-material',
      'Surface contracts require an explicit material.',
    );
  }
  const charts = buildSurfaceContractCharts(context, state, declaration);
  const slots = buildSurfaceContractSlots(context, state, declaration);
  if (width === null || height === null || declaration.material === null) return null;
  return freeze({
    symbol: entry.symbol,
    atlas: freeze({ width, height, span: declaration.atlas?.span ?? declaration.span }),
    charts,
    material: declaration.material,
    slots,
    span: declaration.span,
  });
};

const buildSurfaceSlots = (
  context: AssemblyContext,
  state: AssemblyState,
  declaration: AssetSurfaceDecl,
  contract: TypedSurfaceContract,
): Readonly<Record<string, AssetValue>> => {
  const slots = record<AssetValue>();
  const seen = new Set<string>();
  for (const slot of declaration.slots) {
    if (seen.has(slot.id)) {
      context.issue(
        state.path,
        slot.span,
        'asset.duplicate-slot',
        `Surface slot "${slot.id}" is set more than once.`,
      );
    }
    seen.add(slot.id);
    const type = contract.slots[slot.id];
    if (type === undefined) {
      context.issue(
        state.path,
        slot.span,
        'asset.unknown-slot',
        `Concrete surface sets undeclared slot "${slot.id}".`,
      );
      continue;
    }
    if (slot.value === null) continue;
    const value = compileAndEvaluateHirExpression(
      slot.value,
      type,
      new Map(),
      new Map(),
      state.path,
      context.issue,
    );
    if (value !== null) slots[slot.id] = value;
  }
  for (const id of Object.keys(contract.slots)) {
    if (!seen.has(id)) {
      context.issue(
        state.path,
        declaration.span,
        'asset.missing-slot',
        `Concrete surface must set slot "${id}" exactly once.`,
      );
    }
  }
  return freeze(slots);
};

export const buildSurface = (
  context: AssemblyContext,
  state: AssemblyState,
  entry: AssemblyEntry,
  contracts: Readonly<Record<string, TypedSurfaceContract>>,
): TypedSurface | null => {
  const declaration = entry.declaration as AssetSurfaceDecl;
  const contractEntry = context.resolve(state, declaration.contract, 'surface-contract');
  const contract = contractEntry === null ? null : contracts[contractEntry.symbol.key];
  if (contractEntry === null) return null;
  if (contract === null || contract === undefined) {
    context.issue(
      state.path,
      declaration.contract.span,
      'asset.internal-reference',
      'Resolved surface contract is missing from the typed HIR index.',
    );
    return null;
  }
  if (declaration.material === null || declaration.material !== contract.material) {
    context.issue(
      state.path,
      declaration.span,
      'asset.material-mismatch',
      'A concrete surface must explicitly use its contract material.',
    );
  }
  const slots = buildSurfaceSlots(context, state, declaration, contract);
  const textureSource: AssetUnloweredTextureSource | null =
    declaration.texture === null
      ? null
      : freeze({
          kind: 'unlowered-texture-source',
          payload: declaration.texture,
          span: declaration.texture.span,
        });
  validateConcreteSurfaceCharts(
    textureSource,
    contract,
    state.path,
    declaration.span,
    context.issue,
  );
  return freeze({
    symbol: entry.symbol,
    contract: contract.symbol,
    textureSource,
    material: declaration.material ?? contract.material,
    slots,
    span: declaration.span,
  });
};
