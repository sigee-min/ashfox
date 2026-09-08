import assert from 'node:assert/strict';

import type {
  ProgramExpr,
  ProgramProperty,
  ProgramTextureChart,
  ProgramTextureDecl,
  ProgramTextureGrain,
  ProgramTexturePalette,
  ProgramTextureStampDecl
} from '../../../src/project/program/syntax/contract';
import type { SourceSpan } from '../../../src/project/source/contract';
import {
  assetExactNumber,
  assetNumberValue,
  assetVectorValue,
  type AssetValue
} from '../../../src/compiler/program/asset/value/contract';
import type {
  AssetSymbolId,
  AssetTexelValue,
  AssetUnloweredTextureSource,
  TypedSurface,
  TypedSurfaceContract
} from '../../../src/compiler/program/asset/contract';
import type { AssetTextureIssue, AssetTextureUsage } from '../../../src/compiler/program/asset/texture/contract';
import { materializeAssetTexturePlan } from '../../../src/compiler/program/asset/texturePlan';
import { rasterizeCanonicalTexture } from '../../../src/textures/textureRecipe/raster';

const span = (offset = 1): SourceSpan => Object.freeze({
  start: Object.freeze({ offset, line: 1, column: offset }),
  end: Object.freeze({ offset: offset + 1, line: 1, column: offset + 1 })
});

const number = (numerator: bigint, denominator = 1n, unit: 'plain' | 'texel' = 'plain'): ProgramExpr =>
  Object.freeze({ kind: 'number' as const, numerator, denominator, text: numerator.toString(),
    unit, rawUnit: unit === 'plain' ? '' : unit, span: span() });

const vector = (values: readonly ProgramExpr[]): ProgramExpr =>
  Object.freeze({ kind: 'vector' as const, values: Object.freeze([...values]), span: span() });

const name = (value: string): ProgramExpr => Object.freeze({ kind: 'name' as const, value, span: span() });
const color = (value: string): ProgramExpr => Object.freeze({ kind: 'color' as const, value, span: span() });
const property = (nameValue: string, value: ProgramExpr): ProgramProperty => Object.freeze({
  kind: 'property', name: nameValue, value, span: span()
});

const symbols = (): Readonly<{ readonly surface: AssetSymbolId; readonly contract: AssetSymbolId }> => {
  const contract = Object.freeze({ modulePath: 'root', name: 'skin-contract', kind: 'surface-contract', key: 'root:surface-contract:skin-contract' }) as AssetSymbolId;
  const surface = Object.freeze({ modulePath: 'root', name: 'skin', kind: 'surface', key: 'root:surface:skin' }) as AssetSymbolId;
  return { surface, contract };
};

const chartAbi = (width: number, height: number, coverage: 'opaque' | 'binary' | 'optional' = 'optional') => ({
  id: 'body', layout: 'flat' as const,
    width: assetNumberValue(assetExactNumber(BigInt(width), 1n, 'texel')) as AssetTexelValue,
  height: assetNumberValue(assetExactNumber(BigInt(height), 1n, 'texel')) as AssetTexelValue,
  coverage, span: span()
});

const texture = (width: number, height: number, seed = 7n, bits: string | null = null): ProgramTextureDecl => {
  const palette: ProgramTexturePalette = Object.freeze({ kind: 'palette', properties: Object.freeze([
    property('accent', color('#e43b44')),
    property('body', vector([color('#24151a'), color('#8f3f3f'), color('#e0a15a')]))
  ]), span: span() });
  const chartStatements: ProgramTextureChart['statements'][number][] = [
    property('origin', vector([number(0n, 1n, 'texel'), number(0n, 1n, 'texel')])),
    property('fill', name('body'))
  ];
  if (bits !== null) chartStatements.push(Object.freeze({ kind: 'coverage', bits, span: span() }));
  const chart: ProgramTextureChart = Object.freeze({ kind: 'chart', id: 'body', layout: 'flat',
    statements: Object.freeze(chartStatements), span: span() });
  const grain: ProgramTextureGrain = Object.freeze({ kind: 'grain', algorithm: 'clustered',
    seed: property('seed', number(seed)), span: span() });
  return Object.freeze({ kind: 'texture', id: 'skin', statements: Object.freeze([
    property('atlas', vector([number(BigInt(width), 1n, 'texel'), number(BigInt(height), 1n, 'texel')])),
    property('background', name('accent')), property('background-alpha', number(255n)),
    palette, chart, grain
  ]), span: span() });
};

const sourceAndContract = (width: number, height: number, source: ProgramTextureDecl, slots: Readonly<Record<string, AssetValue>> = {}) => {
  const { surface, contract } = symbols();
  const surfaceSource: AssetUnloweredTextureSource = Object.freeze({ kind: 'unlowered-texture-source', payload: source, span: source.span });
  const typedSurface: TypedSurface = Object.freeze({ symbol: surface, contract, textureSource: surfaceSource,
    material: 'opaque', slots, span: source.span });
  const typedContract: TypedSurfaceContract = Object.freeze({ symbol: contract,
    atlas: Object.freeze({ width: assetNumberValue(assetExactNumber(BigInt(width), 1n, 'texel')) as AssetTexelValue,
      height: assetNumberValue(assetExactNumber(BigInt(height), 1n, 'texel')) as AssetTexelValue, span: span() }),
    charts: Object.freeze({ body: chartAbi(width, height) }), material: 'opaque', slots: Object.freeze({}), span: span() });
  return { typedSurface, typedContract };
};

const usage = (width: number, height: number): AssetTextureUsage => Object.freeze({ chart: 'body',
  shape: Object.freeze({ kind: 'flat', size: Object.freeze([width, height]) as readonly [number, number] }), span: span() });

const boxUsage = (x: number, y: number, z: number): AssetTextureUsage => Object.freeze({ chart: 'body',
  shape: Object.freeze({ kind: 'box', size: Object.freeze([x, y, z]) as readonly [number, number, number] }), span: span() });

const build = (source: ProgramTextureDecl, width: number, height: number, slots: Readonly<Record<string, AssetValue>> = {}) => {
  const { typedSurface, typedContract } = sourceAndContract(width, height, source, slots);
  const diagnostics: Array<{ readonly code: string; readonly span: SourceSpan }> = [];
  const issue: AssetTextureIssue = (_path, owner, code) => diagnostics.push({ code, span: owner });
  const plan = materializeAssetTexturePlan(typedSurface, typedContract, [usage(width, height)], 'root.ashfox', issue);
  return { plan, diagnostics };
};

// Protection preserves local color but never overrides authoritative binary coverage.
{
  const base = texture(4, 4, 7n, '1111101111111111');
  const chart = base.statements.find((entry): entry is ProgramTextureChart => entry.kind === 'chart')!;
  const stamp: ProgramTextureStampDecl = { kind: 'stamp-decl', id: 'eye', properties: [
    property('pixels', { kind: 'string', value: 'aa/aa', span: span() }), property('a', name('accent'))
  ], span: span() };
  const marked: ProgramTextureDecl = { ...base, statements: [...base.statements.filter((entry) => entry !== chart),
    stamp, { ...chart, statements: [...chart.statements, { kind: 'stamp', id: 'eye', properties: [
      property('anchor', name('center')),
      property('offset', vector([number(0n, 1n, 'texel'), number(0n, 1n, 'texel')])),
      property('protect', number(1n, 1n, 'texel'))
    ], span: span() }] }
  ] };
  const result = build(marked, 4, 4);
  assert.ok(result.plan, JSON.stringify(result.diagnostics));
  const raster = result.plan.texture.raster!;
  const image = rasterizeCanonicalTexture(4, 4, { background: raster.background,
    backgroundAlpha: raster.backgroundAlpha, canvasDetails: raster.canvasDetails,
    alphaMasks: raster.alphaMasks ?? [] });
  assert.equal(image.rgba.at(5 * 4 + 3), 0, 'coverage removes even a protected painted stamp pixel');
  assert.equal(image.rgba.at(6 * 4 + 3), 255, 'other stamp pixels stay opaque');
  assert.equal(image.rgba.at(0), 143, 'protected margin retains original fill red channel');
}

{
  const source = texture(16, 16);
  const first = build(source, 16, 16).plan;
  const second = build(source, 16, 16).plan;
  assert.ok(first);
  assert.ok(second);
  assert.equal(first.texture.source.contentHash, second.texture.source.contentHash);
  assert.equal(first.texture.source.byteLength, second.texture.source.byteLength);
  assert.deepEqual(first.texture.raster, second.texture.raster);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.texture));
  assert.ok(Object.isFrozen(first.charts));

  const palette = source.statements.find((entry): entry is ProgramTexturePalette => entry.kind === 'palette')!;
  const reordered = Object.freeze({ ...source, statements: Object.freeze(source.statements.map((entry) =>
    entry === palette ? Object.freeze({ ...palette, properties: Object.freeze([...palette.properties].reverse()) }) : entry)) });
  const reorderedPlan = build(reordered, 16, 16).plan;
  assert.ok(reorderedPlan);
  assert.equal(first.texture.source.contentHash, reorderedPlan.texture.source.contentHash);
}

{
  const stamp: ProgramTextureStampDecl = Object.freeze({ kind: 'stamp-decl', id: 'eye', properties: Object.freeze([
    property('pixels', Object.freeze({ kind: 'string' as const, value: 'a', span: span() })), property('a', name('accent'))
  ]), span: span() });
  const base = texture(16, 16, 7n);
  const chart = base.statements.find((entry): entry is ProgramTextureChart => entry.kind === 'chart')!;
  const grain = base.statements.find((entry): entry is ProgramTextureGrain => entry.kind === 'grain')!;
  const stamped: ProgramTextureDecl = Object.freeze({ ...base, statements: Object.freeze([
    ...base.statements.filter((entry) => entry !== chart && entry !== grain), stamp,
    Object.freeze({ ...chart, statements: Object.freeze([...chart.statements,
      Object.freeze({ kind: 'stamp' as const, id: 'eye', properties: Object.freeze([
        property('at', vector([number(1n, 1n, 'texel'), number(1n, 1n, 'texel')]))
      ]), span: span() })]) }), grain
  ]) });
  const altered = build(texture(16, 16, 19n), 16, 16).plan;
  const fixed = build(stamped, 16, 16).plan;
  assert.ok(altered && fixed);
  assert.notEqual(altered.texture.source.contentHash, fixed.texture.source.contentHash);
  const fixedRaster = fixed.texture.raster!;
  const fixedPixels = rasterizeCanonicalTexture(fixed.texture.width, fixed.texture.height, {
    background: fixedRaster.background, backgroundAlpha: fixedRaster.backgroundAlpha,
    canvasDetails: fixedRaster.canvasDetails, alphaMasks: fixedRaster.alphaMasks ?? [] });
  const eye = (1 * 16 + 1) * 4;
  assert.deepEqual([fixedPixels.rgba.at(eye), fixedPixels.rgba.at(eye + 1), fixedPixels.rgba.at(eye + 2)], [228, 59, 68]);
}

{
  const source = texture(4, 4, 7n, '1111000011110000');
  const result = build(source, 4, 4);
  assert.ok(result.plan);
  const raster = result.plan.texture.raster;
  assert.ok(raster);
  assert.equal(raster.alphaMasks?.length, 1);
  assert.equal(raster.alphaMasks?.[0]?.bits, '1111000011110000');
  const invalid = build(texture(4, 4, 7n, '10'), 4, 4);
  assert.equal(invalid.plan, null);
  assert.ok(invalid.diagnostics.some((entry) => entry.code === 'asset.texture.coverage-mismatch'));
}

{
  const invalidOrigin = texture(4, 4);
  const chart = invalidOrigin.statements.find((entry): entry is ProgramTextureChart => entry.kind === 'chart')!;
  const malformed: ProgramTextureDecl = Object.freeze({ ...invalidOrigin, statements: Object.freeze(invalidOrigin.statements.map((entry) => entry === chart
    ? Object.freeze({ ...chart, statements: Object.freeze(chart.statements.map((child) => child.kind === 'property' && child.name === 'origin'
      ? property('origin', vector([number(4n, 1n, 'texel'), number(4n, 1n, 'texel')])) : child)) }) : entry)) });
  const result = build(malformed, 4, 4);
  assert.equal(result.plan, null);
  assert.ok(result.diagnostics.some((entry) => entry.code === 'asset.texture.out-of-bounds'));
}

{
  const contractSlot = assetVectorValue([
    assetNumberValue(assetExactNumber(1n, 1n, 'texel')),
    assetNumberValue(assetExactNumber(2n, 1n, 'texel'))
  ], 'vec2<texel>');
  const invalid = sourceAndContract(4, 4, texture(4, 4), { bad: contractSlot });
  invalid.typedContract = Object.freeze({ ...invalid.typedContract, slots: Object.freeze({ bad: 'color' }) });
  const diagnostics: string[] = [];
  const result = materializeAssetTexturePlan(invalid.typedSurface, invalid.typedContract, [usage(4, 4)],
    'root.ashfox', (_path, _span, code) => diagnostics.push(code));
  assert.equal(result, null);
  assert.ok(diagnostics.includes('asset.texture.invalid-slot-value'));
}

{
  const result = build(texture(4097, 4), 4097, 4);
  assert.equal(result.plan, null);
  assert.ok(result.diagnostics.some((entry) => entry.code === 'asset.texture.invalid-usage' ||
    entry.code === 'asset.texture.invalid-contract'));
}

{
  const base = texture(8, 4);
  const chart = base.statements.find((entry): entry is ProgramTextureChart => entry.kind === 'chart')!;
  const stamp: ProgramTextureStampDecl = Object.freeze({ kind: 'stamp-decl', id: 'mark', properties: Object.freeze([
    property('pixels', Object.freeze({ kind: 'string' as const, value: 'a', span: span() })), property('a', name('accent'))
  ]), span: span() });
  const boxChart: ProgramTextureChart = Object.freeze({ ...chart, layout: 'box', statements: Object.freeze([
    ...chart.statements,
    Object.freeze({ kind: 'face' as const, direction: 'north' as const, statements: Object.freeze([
      Object.freeze({ kind: 'stamp' as const, id: 'mark', properties: Object.freeze([
        property('at', vector([number(0n, 1n, 'texel'), number(0n, 1n, 'texel')]))
      ]), span: span() })
    ]), span: span() })
  ]) });
  const source: ProgramTextureDecl = Object.freeze({ ...base, statements: Object.freeze([
    ...base.statements.filter((entry) => entry !== chart), stamp, boxChart
  ]) });
  const pair = sourceAndContract(8, 4, source);
  const abi = chartAbi(8, 4);
  pair.typedContract = Object.freeze({ ...pair.typedContract,
    charts: Object.freeze({ body: Object.freeze({ ...abi, layout: 'box' as const }) }) });
  const diagnostics: string[] = [];
  const plan = materializeAssetTexturePlan(pair.typedSurface, pair.typedContract, [boxUsage(2, 2, 2)],
    'root.ashfox', (_path, _span, code) => diagnostics.push(code));
  assert.ok(plan);
  const rasterSpec = plan.texture.raster!;
  const pixels = rasterizeCanonicalTexture(plan.texture.width, plan.texture.height, {
    background: rasterSpec.background, backgroundAlpha: rasterSpec.backgroundAlpha,
    canvasDetails: rasterSpec.canvasDetails, alphaMasks: rasterSpec.alphaMasks ?? [] });
  const northPixel = (2 * 8 + 2) * 4;
  assert.deepEqual([pixels.rgba.at(northPixel), pixels.rgba.at(northPixel + 1),
    pixels.rgba.at(northPixel + 2)], [228, 59, 68]);
  assert.deepEqual(diagnostics, []);
}
