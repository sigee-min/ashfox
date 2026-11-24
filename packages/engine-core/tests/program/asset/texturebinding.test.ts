import assert from 'node:assert/strict';

import type {
  ProgramExpr,
  ProgramProperty,
  ProgramTextureChart,
  ProgramTextureDecl,
  ProgramTextureGrain,
  ProgramTexturePalette,
  ProgramUnit,
} from '../../../src/project/program/syntax/contract';
import type { SourceSpan } from '../../../src/project/source/contract';
import {
  assetExactNumber,
  assetNumberValue,
  assetVectorValue,
  type AssetNumberValue,
  type AssetValue,
} from '../../../src/compiler/program/asset/value/contract';
import type {
  AssetExactFrame,
  AssetIntegerValue,
  AssetSymbolId,
  AssetSymbolKind,
  AssetTexelValue,
  TypedAssetAssembly,
  TypedAssetHir,
  TypedAssetModule,
  TypedChartAbi,
  TypedSurface,
  TypedSurfaceContract,
} from '../../../src/compiler/program/asset/contract';
import type {
  InstantiatedAssetIr,
  InstantiatedComponentInstance,
  InstantiatedGeometryNode,
  InstantiatedSurfaceBinding,
} from '../../../src/compiler/program/asset/ir';
import { lowerAssetTextures } from '../../../src/compiler/program/asset/textureBinding';

const span = (_path: string, offset: number): SourceSpan =>
  Object.freeze({
    start: Object.freeze({ offset, line: 1, column: offset + 1 }),
    end: Object.freeze({ offset: offset + 1, line: 1, column: offset + 2 }),
  });

const numberExpr = (
  numerator: bigint,
  denominator = 1n,
  unit: ProgramUnit = 'plain',
): ProgramExpr =>
  Object.freeze({
    kind: 'number',
    numerator,
    denominator,
    text: numerator.toString(),
    unit,
    rawUnit: unit === 'plain' ? '' : unit,
    span: span('surface.ashfox', 1),
  });

const vectorExpr = (values: readonly ProgramExpr[]): ProgramExpr =>
  Object.freeze({
    kind: 'vector',
    values: Object.freeze([...values]),
    span: span('surface.ashfox', 2),
  });
const nameExpr = (value: string): ProgramExpr =>
  Object.freeze({
    kind: 'name',
    value,
    span: span('surface.ashfox', 3),
  });
const colorExpr = (value: string): ProgramExpr =>
  Object.freeze({
    kind: 'color',
    value,
    span: span('surface.ashfox', 4),
  });
const property = (name: string, value: ProgramExpr): ProgramProperty =>
  Object.freeze({
    kind: 'property',
    name,
    value,
    span: span('surface.ashfox', 5),
  });

const texel = (value: bigint): AssetTexelValue =>
  assetNumberValue(assetExactNumber(value, 1n, 'texel')) as AssetTexelValue;
const unit = (value: bigint, denominator = 1n): AssetNumberValue =>
  assetNumberValue(assetExactNumber(value, denominator, 'unit'));
const unitVector = (values: readonly [bigint, bigint, bigint], denominator = 1n): AssetValue =>
  assetVectorValue(
    values.map((value) => unit(value, denominator)),
    'vec3<unit>',
  );
const unitVector2 = (values: readonly [bigint, bigint]): AssetValue =>
  assetVectorValue(
    values.map((value) => unit(value)),
    'vec2<unit>',
  );

const symbol = (modulePath: string, kind: AssetSymbolKind, name: string): AssetSymbolId =>
  Object.freeze({ modulePath, kind, name, key: `${modulePath}\u0000${kind}\u0000${name}` });

const payload = (
  atlasWidth: number,
  atlasHeight: number,
  layout: 'box' | 'flat',
  originX = 0,
  originY = 0,
): ProgramTextureDecl => {
  const palette: ProgramTexturePalette = Object.freeze({
    kind: 'palette',
    properties: Object.freeze([
      property('accent', colorExpr('#e43b44')),
      property(
        'body',
        vectorExpr([colorExpr('#24151a'), colorExpr('#8f3f3f'), colorExpr('#e0a15a')]),
      ),
    ]),
    span: span('surface.ashfox', 6),
  });
  const chart: ProgramTextureChart = Object.freeze({
    kind: 'chart',
    id: 'body',
    layout,
    statements: Object.freeze([
      property(
        'origin',
        vectorExpr([
          numberExpr(BigInt(originX), 1n, 'texel'),
          numberExpr(BigInt(originY), 1n, 'texel'),
        ]),
      ),
      property('fill', nameExpr('body')),
    ]),
    span: span('surface.ashfox', 7),
  });
  const grain: ProgramTextureGrain = Object.freeze({
    kind: 'grain',
    algorithm: 'clustered',
    seed: null,
    span: span('surface.ashfox', 8),
  });
  return Object.freeze({
    kind: 'texture',
    id: 'skin',
    statements: Object.freeze([
      property(
        'atlas',
        vectorExpr([
          numberExpr(BigInt(atlasWidth), 1n, 'texel'),
          numberExpr(BigInt(atlasHeight), 1n, 'texel'),
        ]),
      ),
      property('background', nameExpr('accent')),
      property('background-alpha', numberExpr(255n)),
      palette,
      chart,
      grain,
    ]),
    span: span('surface.ashfox', 9),
  });
};

interface SurfaceFixture {
  readonly surface: TypedSurface;
  readonly contract: TypedSurfaceContract;
  readonly module: TypedAssetModule;
  readonly chartWidth: number;
  readonly chartHeight: number;
  readonly layout: 'box' | 'flat';
}

const surfaceFixture = (
  name: string,
  layout: 'box' | 'flat',
  atlasWidth: number,
  atlasHeight: number,
  chartWidth: number,
  chartHeight: number,
): SurfaceFixture => {
  const modulePath = `surfaces/${name}`;
  const contractSymbol = symbol(modulePath, 'surface-contract', `${name}Contract`);
  const surfaceSymbol = symbol(modulePath, 'surface', name);
  const source = payload(atlasWidth, atlasHeight, layout);
  const chart: TypedChartAbi = Object.freeze({
    id: 'body',
    layout,
    width: texel(BigInt(chartWidth)),
    height: texel(BigInt(chartHeight)),
    coverage: 'optional',
    span: span(`${modulePath}.ashfox`, 11),
  });
  const contract: TypedSurfaceContract = Object.freeze({
    symbol: contractSymbol,
    atlas: Object.freeze({
      width: texel(BigInt(atlasWidth)),
      height: texel(BigInt(atlasHeight)),
      span: span(`${modulePath}.ashfox`, 10),
    }),
    charts: Object.freeze({ body: chart }),
    material: 'opaque',
    slots: Object.freeze({}),
    span: span(`${modulePath}.ashfox`, 12),
  });
  const surface: TypedSurface = Object.freeze({
    symbol: surfaceSymbol,
    contract: contractSymbol,
    textureSource: Object.freeze({
      kind: 'unlowered-texture-source',
      payload: source,
      span: source.span,
    }),
    material: 'opaque',
    slots: Object.freeze({}),
    span: span(`${modulePath}.ashfox`, 13),
  });
  const module: TypedAssetModule = Object.freeze({
    path: `${modulePath}.ashfox`,
    id: modulePath,
    imports: Object.freeze({}),
    exports: Object.freeze({ [name]: surfaceSymbol }),
    declarations: Object.freeze([contractSymbol, surfaceSymbol]),
  });
  return { surface, contract, module, chartWidth, chartHeight, layout };
};

const frame = (): AssetExactFrame =>
  Object.freeze({
    origin: Object.freeze([
      assetExactNumber(0n, 1n, 'unit'),
      assetExactNumber(0n, 1n, 'unit'),
      assetExactNumber(0n, 1n, 'unit'),
    ]),
    xAxis: Object.freeze([1, 0, 0]),
    yAxis: Object.freeze([0, 1, 0]),
    zAxis: Object.freeze([0, 0, 1]),
    determinant: 1,
  }) as AssetExactFrame;

const asset = symbol('root', 'asset', 'Dragon');
const skeleton = symbol('root', 'skeleton', 'Adult');
const rig = symbol('root', 'rig-contract', 'DragonRig');
const component = symbol('root', 'component', 'Body');

const hirFor = (fixtures: readonly SurfaceFixture[]): TypedAssetHir => {
  const surfaces: Record<string, TypedSurface> = {};
  const contracts: Record<string, TypedSurfaceContract> = {};
  const modules: Record<string, TypedAssetModule> = {
    root: Object.freeze({
      path: 'root.ashfox',
      id: 'root',
      imports: Object.freeze({}),
      exports: Object.freeze({ Dragon: asset }),
      declarations: Object.freeze([asset]),
    }),
  };
  const symbols: Record<string, AssetSymbolId> = {
    [asset.key]: asset,
    [skeleton.key]: skeleton,
    [rig.key]: rig,
    [component.key]: component,
  };
  for (const fixture of fixtures) {
    surfaces[fixture.surface.symbol.key] = fixture.surface;
    contracts[fixture.contract.symbol.key] = fixture.contract;
    modules[fixture.module.id] = fixture.module;
    symbols[fixture.surface.symbol.key] = fixture.surface.symbol;
    symbols[fixture.contract.symbol.key] = fixture.contract.symbol;
  }
  const assembly: TypedAssetAssembly = Object.freeze({
    symbol: asset,
    settings: Object.freeze({
      density: assetNumberValue(assetExactNumber(16n, 1n, 'plain')) as AssetIntegerValue,
      forward: 'north',
    }),
    skeleton,
    motions: Object.freeze([]),
    uses: Object.freeze([]),
    connections: Object.freeze([]),
    span: span('root.ashfox', 20),
  });
  return Object.freeze({
    rootPath: 'root.ashfox',
    modules: Object.freeze(modules),
    symbols: Object.freeze(symbols),
    socketContracts: Object.freeze({}),
    rigs: Object.freeze({}),
    skeletons: Object.freeze({}),
    surfaceContracts: Object.freeze(contracts),
    surfaces: Object.freeze(surfaces),
    components: Object.freeze({}),
    motions: Object.freeze({}),
    assets: Object.freeze({ [asset.key]: assembly }),
  });
};

const node = (
  kind: 'cube' | 'plane' | 'bone',
  id: string,
  size: AssetValue,
  selected: AssetSymbolId | null,
  sourcePath = 'root.ashfox',
): InstantiatedGeometryNode =>
  Object.freeze({
    kind,
    id,
    attachmentBoneId: null,
    properties: Object.freeze([
      { name: 'size', value: size, span: span(sourcePath, id.length + 30) },
    ]),
    surface:
      selected === null
        ? null
        : Object.freeze({
            port: 'skin',
            chart: 'body',
            surface: selected,
            span: span(sourcePath, id.length + 40),
          }),
    children: Object.freeze([]),
    sourcePath,
    span: span(sourcePath, id.length + 50),
  });

const instance = (
  id: string,
  geometry: readonly InstantiatedGeometryNode[],
): InstantiatedComponentInstance =>
  Object.freeze({
    id,
    component,
    placementAuthority: 'rig',
    placement: frame(),
    parameters: Object.freeze({}),
    socketEndpoints: Object.freeze([]),
    geometry: Object.freeze([...geometry]),
    sourcePath: 'root.ashfox',
    span: span('root.ashfox', id.length + 60),
  });

const surfaceBinding = (fixture: SurfaceFixture): InstantiatedSurfaceBinding =>
  Object.freeze({
    surface: fixture.surface.symbol,
    contract: fixture.contract.symbol,
    material: 'opaque',
    charts: Object.freeze(['body']),
    span: span(fixture.module.path, 14),
  });

const irFor = (
  fixtures: readonly SurfaceFixture[],
  instances: readonly InstantiatedComponentInstance[],
): InstantiatedAssetIr =>
  Object.freeze({
    asset,
    settings: Object.freeze({
      density: assetNumberValue(assetExactNumber(16n, 1n, 'plain')),
      forward: 'north',
    }),
    rig,
    skeleton,
    bones: Object.freeze([]),
    instances: Object.freeze([...instances]),
    surfaces: Object.freeze(fixtures.map(surfaceBinding)),
    connections: Object.freeze([]),
    motions: Object.freeze([]),
    budget: Object.freeze({
      limits: Object.freeze({
        instances: 64,
        bones: 64,
        nodes: 256,
        faces: 1024,
        motionKeys: 1024,
        diagnostics: 256,
      }),
      used: Object.freeze({
        instances: 0,
        bones: 0,
        nodes: 0,
        faces: 0,
        motionKeys: 0,
        diagnostics: 0,
      }),
    }),
  });

const codes = (result: ReturnType<typeof lowerAssetTextures>): readonly string[] =>
  result.ok ? [] : result.diagnostics.map((item) => item.code);

const box = surfaceFixture('box', 'box', 16, 8, 8, 4);
const flat = surfaceFixture('flat', 'flat', 16, 8, 4, 4);

{
  const result = lowerAssetTextures(
    hirFor([box, flat]),
    irFor(
      [box, flat],
      [
        instance('body', [
          node('cube', 'cube', unitVector([2n, 2n, 2n]), box.surface.symbol),
          node('plane', 'plane', unitVector2([4n, 4n]), flat.surface.symbol),
        ]),
      ],
    ),
  );
  assert.equal(result.ok, true, codes(result).join(', '));
  if (result.ok) {
    assert.deepEqual(result.resolution, [16, 8]);
    assert.deepEqual(
      result.plans.map((plan) => plan.surfaceSymbol.key),
      [box.surface.symbol.key, flat.surface.symbol.key].sort(),
    );
  }
}

{
  const result = lowerAssetTextures(
    hirFor([box]),
    irFor(
      [box],
      [
        instance('body', [
          node('cube', 'one', unitVector([2n, 2n, 2n]), box.surface.symbol),
          node('cube', 'two', unitVector([2n, 2n, 2n]), box.surface.symbol),
        ]),
      ],
    ),
  );
  assert.equal(result.ok, true, codes(result).join(', '));
}

{
  const result = lowerAssetTextures(
    hirFor([box]),
    irFor(
      [box],
      [
        instance('body', [
          node('cube', 'one', unitVector([2n, 2n, 2n]), box.surface.symbol),
          node('cube', 'two', unitVector([3n, 2n, 2n]), box.surface.symbol),
        ]),
      ],
    ),
  );
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('asset.texture.usage-mismatch'));
}

{
  const fractional = unitVector([1n, 2n, 2n], 2n);
  const result = lowerAssetTextures(
    hirFor([box]),
    irFor([box], [instance('body', [node('cube', 'fractional', fractional, box.surface.symbol)])]),
  );
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('asset.value.unsafe-number'));
}

{
  const unsafe = unitVector([1n << 60n, 2n, 2n]);
  const result = lowerAssetTextures(
    hirFor([box]),
    irFor([box], [instance('body', [node('cube', 'unsafe', unsafe, box.surface.symbol)])]),
  );
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('asset.value.unsafe-number'));
}

console.log('texture binding lowering ok');
