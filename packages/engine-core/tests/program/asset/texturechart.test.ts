import assert from 'node:assert/strict';

import type {
  ProgramExpr,
  ProgramProperty,
  ProgramTextureChart,
  ProgramTextureDecl,
  ProgramTextureGrain,
  ProgramTexturePalette,
  ProgramTextureStampDecl,
} from '../../../src/project/program/syntax/contract';
import type { SourceSpan } from '../../../src/project/source/contract';
import {
  assetExactNumber,
  assetNumberValue,
  type AssetValue,
} from '../../../src/compiler/program/asset/value/contract';
import type {
  AssetSymbolId,
  AssetTexelValue,
  AssetUnloweredTextureSource,
  TypedSurface,
  TypedSurfaceContract,
} from '../../../src/compiler/program/asset/contract';
import type {
  AssetTextureIssue,
  AssetTextureUsage,
} from '../../../src/compiler/program/asset/texture/contract';
import { materializeAssetTexturePlan } from '../../../src/compiler/program/asset/texturePlan';
import { rasterizeCanonicalTexture } from '../../../src/textures/textureRecipe/raster';

const span = (offset = 1): SourceSpan =>
  Object.freeze({
    start: Object.freeze({ offset, line: 1, column: offset }),
    end: Object.freeze({ offset: offset + 1, line: 1, column: offset + 1 }),
  });

const number = (
  numerator: bigint,
  denominator = 1n,
  unit: 'plain' | 'texel' = 'plain',
): ProgramExpr =>
  Object.freeze({
    kind: 'number' as const,
    numerator,
    denominator,
    text: numerator.toString(),
    unit,
    rawUnit: unit === 'plain' ? '' : unit,
    span: span(),
  });

const vector = (values: readonly ProgramExpr[]): ProgramExpr =>
  Object.freeze({ kind: 'vector' as const, values: Object.freeze([...values]), span: span() });

const name = (value: string): ProgramExpr =>
  Object.freeze({ kind: 'name' as const, value, span: span() });

const color = (value: string): ProgramExpr =>
  Object.freeze({ kind: 'color' as const, value, span: span() });

const property = (nameValue: string, value: ProgramExpr): ProgramProperty =>
  Object.freeze({
    kind: 'property',
    name: nameValue,
    value,
    span: span(),
  });

const symbols = (): Readonly<{
  readonly surface: AssetSymbolId;
  readonly contract: AssetSymbolId;
}> => {
  const contract = Object.freeze({
    modulePath: 'root',
    name: 'skin-contract',
    kind: 'surface-contract',
    key: 'root:surface-contract:skin-contract',
  }) as AssetSymbolId;
  const surface = Object.freeze({
    modulePath: 'root',
    name: 'skin',
    kind: 'surface',
    key: 'root:surface:skin',
  }) as AssetSymbolId;
  return { surface, contract };
};

const chartAbi = (
  width: number,
  height: number,
  coverage: 'opaque' | 'binary' | 'optional' = 'optional',
) => ({
  id: 'body',
  layout: 'flat' as const,
  width: assetNumberValue(assetExactNumber(BigInt(width), 1n, 'texel')) as AssetTexelValue,
  height: assetNumberValue(assetExactNumber(BigInt(height), 1n, 'texel')) as AssetTexelValue,
  coverage,
  span: span(),
});

const texture = (
  width: number,
  height: number,
  seed = 7n,
  bits: string | null = null,
): ProgramTextureDecl => {
  const palette: ProgramTexturePalette = Object.freeze({
    kind: 'palette',
    properties: Object.freeze([
      property('accent', color('#e43b44')),
      property('body', vector([color('#24151a'), color('#8f3f3f'), color('#e0a15a')])),
    ]),
    span: span(),
  });
  const chartStatements: ProgramTextureChart['statements'][number][] = [
    property('origin', vector([number(0n, 1n, 'texel'), number(0n, 1n, 'texel')])),
    property('fill', name('body')),
  ];
  if (bits !== null) chartStatements.push(Object.freeze({ kind: 'coverage', bits, span: span() }));
  const chart: ProgramTextureChart = Object.freeze({
    kind: 'chart',
    id: 'body',
    layout: 'flat',
    statements: Object.freeze(chartStatements),
    span: span(),
  });
  const grain: ProgramTextureGrain = Object.freeze({
    kind: 'grain',
    algorithm: 'clustered',
    seed: property('seed', number(seed)),
    span: span(),
  });
  return Object.freeze({
    kind: 'texture',
    id: 'skin',
    statements: Object.freeze([
      property(
        'atlas',
        vector([number(BigInt(width), 1n, 'texel'), number(BigInt(height), 1n, 'texel')]),
      ),
      property('background', name('accent')),
      property('background_alpha', number(255n)),
      palette,
      chart,
      grain,
    ]),
    span: span(),
  });
};

const sourceAndContract = (
  width: number,
  height: number,
  source: ProgramTextureDecl,
  slots: Readonly<Record<string, AssetValue>> = {},
) => {
  const { surface, contract } = symbols();
  const surfaceSource: AssetUnloweredTextureSource = Object.freeze({
    kind: 'unlowered-texture-source',
    payload: source,
    span: source.span,
  });
  const typedSurface: TypedSurface = Object.freeze({
    symbol: surface,
    contract,
    textureSource: surfaceSource,
    material: 'opaque',
    slots,
    span: source.span,
  });
  const typedContract: TypedSurfaceContract = Object.freeze({
    symbol: contract,
    atlas: Object.freeze({
      width: assetNumberValue(assetExactNumber(BigInt(width), 1n, 'texel')) as AssetTexelValue,
      height: assetNumberValue(assetExactNumber(BigInt(height), 1n, 'texel')) as AssetTexelValue,
      span: span(),
    }),
    charts: Object.freeze({ body: chartAbi(width, height) }),
    material: 'opaque',
    slots: Object.freeze({}),
    span: span(),
  });
  return { typedSurface, typedContract };
};

const usage = (width: number, height: number): AssetTextureUsage =>
  Object.freeze({
    chart: 'body',
    shape: Object.freeze({
      kind: 'flat',
      size: Object.freeze([width, height]) as readonly [number, number],
    }),
    span: span(),
  });

const boxUsage = (x: number, y: number, z: number): AssetTextureUsage =>
  Object.freeze({
    chart: 'body',
    shape: Object.freeze({
      kind: 'box',
      size: Object.freeze([x, y, z]) as readonly [number, number, number],
    }),
    span: span(),
  });

const build = (
  source: ProgramTextureDecl,
  width: number,
  height: number,
  slots: Readonly<Record<string, AssetValue>> = {},
) => {
  const { typedSurface, typedContract } = sourceAndContract(width, height, source, slots);
  const diagnostics: Array<{ readonly code: string; readonly span: SourceSpan }> = [];
  const issue: AssetTextureIssue = (_path, owner, code) => diagnostics.push({ code, span: owner });
  const plan = materializeAssetTexturePlan(
    typedSurface,
    typedContract,
    [usage(width, height)],
    'root.ashfox',
    issue,
  );
  return { plan, diagnostics };
};

{
  const base = texture(8, 4);
  const chart = base.statements.find(
    (entry): entry is ProgramTextureChart => entry.kind === 'chart',
  )!;
  const stamp: ProgramTextureStampDecl = Object.freeze({
    kind: 'stamp-decl',
    id: 'mark',
    properties: Object.freeze([
      property('pixels', Object.freeze({ kind: 'string' as const, value: 'a', span: span() })),
      property('a', name('accent')),
    ]),
    span: span(),
  });
  const boxChart: ProgramTextureChart = Object.freeze({
    ...chart,
    layout: 'box',
    statements: Object.freeze([
      ...chart.statements,
      Object.freeze({
        kind: 'face' as const,
        direction: 'north' as const,
        statements: Object.freeze([
          Object.freeze({
            kind: 'stamp' as const,
            id: 'mark',
            properties: Object.freeze([
              property('at', vector([number(0n, 1n, 'texel'), number(0n, 1n, 'texel')])),
            ]),
            span: span(),
          }),
        ]),
        span: span(),
      }),
    ]),
  });
  const source: ProgramTextureDecl = Object.freeze({
    ...base,
    statements: Object.freeze([
      ...base.statements.filter((entry) => entry !== chart),
      stamp,
      boxChart,
    ]),
  });
  const pair = sourceAndContract(8, 4, source);
  const abi = chartAbi(8, 4);
  pair.typedContract = Object.freeze({
    ...pair.typedContract,
    charts: Object.freeze({ body: Object.freeze({ ...abi, layout: 'box' as const }) }),
  });
  const diagnostics: string[] = [];
  const plan = materializeAssetTexturePlan(
    pair.typedSurface,
    pair.typedContract,
    [boxUsage(2, 2, 2)],
    'root.ashfox',
    (_path, _span, code) => diagnostics.push(code),
  );
  assert.ok(plan);
  const rasterSpec = plan.texture.raster!;
  const pixels = rasterizeCanonicalTexture(plan.texture.width, plan.texture.height, {
    background: rasterSpec.background,
    backgroundAlpha: rasterSpec.backgroundAlpha,
    canvasDetails: rasterSpec.canvasDetails,
    alphaMasks: rasterSpec.alphaMasks ?? [],
  });
  const northPixel = (2 * 8 + 2) * 4;
  assert.deepEqual(
    [pixels.rgba.at(northPixel), pixels.rgba.at(northPixel + 1), pixels.rgba.at(northPixel + 2)],
    [228, 59, 68],
  );
  assert.deepEqual(diagnostics, []);
}

// Grouping preserves duplicate declaration and usage diagnostics, including spans.
{
  const source = texture(1, 1);
  const chart = source.statements.find(
    (entry): entry is ProgramTextureChart => entry.kind === 'chart',
  )!;
  const duplicate = { ...chart, span: span(73) };
  const duplicated = build({ ...source, statements: [...source.statements, duplicate] }, 1, 1);
  assert.equal(duplicated.plan, null);
  assert.deepEqual(duplicated.diagnostics, [
    { code: 'asset.texture.chart-count', span: duplicate.span },
  ]);
  const missing = build(
    { ...source, statements: source.statements.filter((entry) => entry !== chart) },
    1,
    1,
  );
  assert.equal(missing.plan, null);
  assert.deepEqual(missing.diagnostics, [{ code: 'asset.texture.chart-count', span: source.span }]);
  const { typedSurface, typedContract } = sourceAndContract(1, 1, source);
  for (const usages of [[], [usage(1, 1), { ...usage(1, 1), span: span(45) }, usage(2, 1)]]) {
    const diagnostics: { code: string; span: SourceSpan }[] = [];
    const result = materializeAssetTexturePlan(
      typedSurface,
      typedContract,
      usages,
      'root.ashfox',
      (_path, owner, code) => diagnostics.push({ code, span: owner }),
    );
    assert.equal(result, null);
    assert.deepEqual(diagnostics, [
      {
        code: usages.length ? 'asset.texture.usage-mismatch' : 'asset.texture.unused-chart',
        span: usages.length ? usages[1]!.span : chart.span,
      },
    ]);
  }
}

{
  const count = 100;
  const source = texture(count, 1);
  const declarations: ProgramTextureChart[] = Array.from({ length: count }, (_, i) => ({
    kind: 'chart',
    id: `chart_${i}`,
    layout: 'flat',
    span: span(i + 1),
    statements: [
      property('origin', vector([number(BigInt(i), 1n, 'texel'), number(0n, 1n, 'texel')])),
      property('fill', name('body')),
    ],
  }));
  const payload = {
    ...source,
    statements: [...source.statements.filter((entry) => entry.kind !== 'chart'), ...declarations],
  };
  const { typedSurface, typedContract } = sourceAndContract(count, 1, payload);
  const contract = {
    ...typedContract,
    charts: Object.fromEntries(
      declarations.map((chart) => [chart.id, { ...chartAbi(1, 1), id: chart.id }]),
    ),
  };
  let reads = 0;
  const usages = declarations.map((chart) => ({
    ...usage(1, 1),
    get chart() {
      reads++;
      return chart.id;
    },
  }));
  const issues: string[] = [];
  const result = materializeAssetTexturePlan(
    typedSurface,
    contract,
    usages,
    'root.ashfox',
    (_path, _span, code) => issues.push(code),
  );
  assert.deepEqual(issues, []);
  assert.ok(result);
  assert.equal(Object.keys(result.charts).length, count);
  assert.ok(reads < count * 10, `Expected linear chart lookup reads, got ${reads}`);
  const overlapping = {
    ...payload,
    statements: payload.statements.map((entry) =>
      entry.kind === 'chart' && ['chart_97', 'chart_98', 'chart_99'].includes(entry.id)
        ? {
            ...entry,
            statements: [
              property('origin', vector([number(0n, 1n, 'texel'), number(0n, 1n, 'texel')])),
              property('fill', name('body')),
            ],
          }
        : entry,
    ),
  };
  const overlapIssues: { code: string; offset: number }[] = [];
  const rejected = materializeAssetTexturePlan(
    sourceAndContract(count, 1, overlapping).typedSurface,
    contract,
    usages,
    'root.ashfox',
    (_path, owner, code) => overlapIssues.push({ code, offset: owner.start.offset }),
  );
  assert.equal(rejected, null);
  assert.deepEqual(
    overlapIssues,
    [98, 99, 100, 99, 100, 100].map((offset) => ({ code: 'asset.texture.overlap', offset })),
  );
}
