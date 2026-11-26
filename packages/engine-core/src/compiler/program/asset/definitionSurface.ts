import { freeze } from '../../../immutable';
import type {
  AssetSurfaceContractDecl,
  AssetSurfaceDecl,
  AssetValueType,
} from '../../../project/program/asset/contract';
import { nullRecord } from './diagnostics';
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

const optionalChartSizes = (
  chart: AssetSurfaceContractDecl['charts'][number],
  path: string,
  issue: AssemblyContext['issue'],
): Readonly<{
  readonly width: AssetTexelValue | null;
  readonly height: AssetTexelValue | null;
}> | null => {
  if (chart.width === null && chart.height === null) return { width: null, height: null };
  if (chart.width === null || chart.height === null) {
    issue(
      path,
      chart.span,
      'asset.invalid-size',
      'Chart width and height must either both be declared or both be omitted for auto-inference.',
    );
    return null;
  }
  const width = texel(chart.width, path, chart.span, issue);
  const height = texel(chart.height, path, chart.span, issue);
  return width !== null && height !== null ? { width, height } : null;
};

const buildSurfaceContractCharts = (
  context: AssemblyContext,
  state: AssemblyState,
  declaration: AssetSurfaceContractDecl,
): Readonly<Record<string, TypedChartAbi>> => {
  const charts = nullRecord<TypedChartAbi>();
  for (const chart of declaration.charts) {
    if (charts[chart.id] !== undefined) {
      context.issue(
        state.path,
        chart.span,
        'asset.duplicate-chart',
        `Surface chart "${chart.id}" is declared more than once.`,
      );
    }
    const sizes = optionalChartSizes(chart, state.path, context.issue);
    if (chart.coverage === null) {
      context.issue(
        state.path,
        chart.span,
        'asset.missing-coverage',
        'Surface charts require an explicit coverage policy.',
      );
    }
    if (sizes !== null && chart.coverage !== null) {
      charts[chart.id] = freeze({
        id: chart.id,
        layout: chart.layout,
        width: sizes.width,
        height: sizes.height,
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
  const slots = nullRecord<AssetValueType>();
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
  const atlas = readContractAtlas(context, state, declaration);
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
  if ((declaration.atlas !== null && atlas === null) || declaration.material === null) return null;
  return freeze({
    symbol: entry.symbol,
    atlas,
    charts,
    material: declaration.material,
    slots,
    span: declaration.span,
  });
};

const readContractAtlas = (
  context: AssemblyContext,
  state: AssemblyState,
  declaration: AssetSurfaceContractDecl,
): TypedSurfaceContract['atlas'] => {
  if (declaration.atlas === null) return null;
  const width = texel(declaration.atlas.width, state.path, declaration.atlas.span, context.issue);
  const height = texel(declaration.atlas.height, state.path, declaration.atlas.span, context.issue);
  if (width === null || height === null) return null;
  return freeze({ width, height, span: declaration.atlas.span });
};

const buildSurfaceSlots = (
  context: AssemblyContext,
  state: AssemblyState,
  declaration: AssetSurfaceDecl,
  contract: TypedSurfaceContract,
): Readonly<Record<string, AssetValue>> => {
  const slots = nullRecord<AssetValue>();
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
