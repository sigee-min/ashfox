import assert from 'node:assert/strict';
import { compileAssetWorkspaceEntry } from '../../../src';
import { rasterizeCanonicalTexture } from '../../../src/textures/textureRecipe/raster';
import { VALID_ASSET_SOURCE, validAssetWorkspace } from './fixture';

const source = (
  placement: string,
  width = 4,
  atlasX = 0,
  pixels = 'aa/aa',
  mappings = 'a = eye;',
  palette = 'eye = #00ff00;',
  height = 4
) =>
  VALID_ASSET_SOURCE
    .replace('width = 16px; height = 8px;', 'width = 64px; height = 16px;')
    .replace('chart body box { width = 16px; height = 8px;',
      `chart body box { width = ${width * 2 + 8}px; height = ${height + 4}px;`)
    .replace('atlas = (16px, 8px);', 'atlas = (64px, 16px);')
    .replace('palette { shadow', `palette { ${palette} shadow`)
    .replace('chart body box { origin = (0px, 0px); fill = body; }',
      `stamp eyes { pixels = "${pixels}"; ${mappings} }
      chart body box { origin = (${atlasX}px, 0px); fill = body;
        face north { stamp eyes { ${placement} } }
      }`)
    .replace('size = (4u, 4u, 4u);', `size = (${width}u, ${height}u, 4u);`);

const compile = (text: string) => compileAssetWorkspaceEntry(validAssetWorkspace(text),
  { packageName: 'wolf', entryName: 'wolf' });

const render = (text: string) => {
  const result = compile(text);
  assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.diagnostics));
  const texture = Object.values(result.model.textures)[0]!;
  const raster = texture.raster!;
  const image = rasterizeCanonicalTexture(texture.width, texture.height, {
    background: raster.background, backgroundAlpha: raster.backgroundAlpha,
    canvasDetails: raster.canvasDetails, alphaMasks: raster.alphaMasks ?? []
  });
  const pixel = (x: number, y: number) => [0, 1, 2, 3].map((channel) =>
    image.rgba.at((y * texture.width + x) * 4 + channel));
  return { result, pixel };
};

const reject = (placement: string, code: string, pixels?: string) => {
  const result = compile(source(placement, 4, 0, pixels));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.diagnostics.some((entry) => entry.code === code), JSON.stringify(result.diagnostics));
    assert.ok(result.diagnostics.every((entry) => entry.source !== undefined));
    assert.equal('model' in result, false);
  }
};

// Alignment is face-local and leaves the actual stamp raster fixed at 2 by 2 pixels.
for (const [anchor, x, y] of [
  ['top_left', 0, 0], ['top', 1, 0], ['top_right', 2, 0],
  ['left', 0, 1], ['center', 1, 1], ['right', 2, 1],
  ['bottom_left', 0, 2], ['bottom', 1, 2], ['bottom_right', 2, 2]
] as const) {
  const anchored = render(source(`anchor = ${anchor}; offset = (0px, 0px);`));
  const absolute = render(source(`at = (${x}px, ${y}px);`));
  assert.deepEqual(anchored.result.model, absolute.result.model);
}

{
  const placement = 'anchor = top_right; offset = (-1px, 1px); protect = 1px;';
  const narrow = render(source(placement));
  const wide = render(source(placement, 8));
  for (const [image, width] of [[narrow, 4], [wide, 8]] as const) {
    let eyes = 0;
    for (let y = 0; y < 4; y += 1) for (let x = 0; x < width; x += 1) {
      if (image.pixel(4 + x, 4 + y).join(',') === '0,255,0,255') eyes += 1;
    }
    assert.equal(eyes, 4);
    assert.deepEqual(image.pixel(4 + width - 3, 5), [0, 255, 0, 255]);
    // Margin freezes the original body base color rather than repainting it.
    assert.deepEqual(image.pixel(4 + width - 4, 4), [168, 58, 31, 255]);
  }
  const moved = render(source(placement, 4, 24));
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 16; x += 1) {
    assert.deepEqual(narrow.pixel(x, y), moved.pixel(x + 24, y));
  }
  assert.deepEqual(compile(source(placement)), compile(source(placement)));
}

// Transparent cells inside the explicitly protected rectangle preserve fill.
{
  const image = render(source('anchor = center; offset = (0px, 0px); protect = 1px;', 4, 0, 'a./.a'));
  assert.deepEqual(image.pixel(6, 5), [168, 58, 31, 255]);
}

reject('anchor = center; offset = (0px, 0px);', 'asset.texture.stamp-off-grid', 'a');
reject('anchor = top_left; offset = (0px, 0px); protect = 1px;', 'asset.texture.stamp-out-of-bounds');
reject('anchor = bottom_right; offset = (1px, 0px);', 'asset.texture.stamp-out-of-bounds');
reject('anchor = unknown; offset = (0px, 0px);', 'asset.texture.invalid-anchor');
reject('anchor = center;', 'asset.texture.stamp-placement');
reject('at = (0px, 0px); offset = (0px, 0px);', 'asset.texture.stamp-placement');
reject('at = (0px, 0px); anchor = center;', 'asset.texture.stamp-placement');
reject('anchor = center; offset = (0.5px, 0px);', 'asset.texture.invalid-vector');
reject('anchor = center; offset = (0px, 0px); protect = -1px;', 'asset.texture.invalid-protection');
reject('anchor = center; offset = (0px, 0px); protect = 0.5px;', 'asset.texture.invalid-integer');
reject('anchor = center; anchor = top; offset = (0px, 0px);', 'asset.texture.duplicate-property');

// Flip transforms stamp contents inside the same 3 by 2 placement rectangle.
{
  const pixels = 'abc/def';
  const mappings = 'a = a; b = b; c = c; d = d; e = e; f = f;';
  const palette = 'a = #ff0000; b = #00ff00; c = #0000ff; d = #ffff00; e = #ff00ff; f = #00ffff;';
  const colors: Readonly<Record<string, readonly number[]>> = {
    a: [255, 0, 0, 255], b: [0, 255, 0, 255], c: [0, 0, 255, 255],
    d: [255, 255, 0, 255], e: [255, 0, 255, 255], f: [0, 255, 255, 255]
  };
  const expected: Readonly<Record<'none' | 'x' | 'y' | 'xy', readonly string[]>> = {
    none: ['abc', 'def'], x: ['cba', 'fed'], y: ['def', 'abc'], xy: ['fed', 'cba']
  };
  const renderStamp = (flip: 'none' | 'x' | 'y' | 'xy' | undefined) => render(source(
    `at = (0px, 0px);${flip === undefined ? '' : ` flip = ${flip};`}`,
    4, 0, pixels, mappings, palette));
  const defaultImage = renderStamp(undefined);
  const explicitNone = renderStamp('none');
  assert.deepEqual(defaultImage.result.model, explicitNone.result.model);
  for (const flip of ['none', 'x', 'y', 'xy'] as const) {
    const image = renderStamp(flip);
    for (let row = 0; row < 2; row += 1) for (let column = 0; column < 3; column += 1) {
      assert.deepEqual(image.pixel(4 + column, 4 + row), colors[expected[flip][row]![column]!]);
    }
  }
}

// A closed enum accepts only the four spellings; values and aliases are rejected.
for (const flip of ['horizontal', 'xz', '"x"'] as const) {
  reject(`at = (0px, 0px); flip = ${flip};`, 'asset.texture.invalid-flip');
}

// Protection still covers the unchanged bounding rectangle, including its transparent cells.
{
  const image = render(source(
    'at = (1px, 1px); flip = xy; protect = 1px;', 4, 0, 'a./.b',
    'a = eye; b = mark;', 'eye = #00ff00; mark = #ff0000;'));
  assert.deepEqual(image.pixel(5, 5), [255, 0, 0, 255]);
  assert.deepEqual(image.pixel(6, 6), [0, 255, 0, 255]);
  assert.deepEqual(image.pixel(6, 5), [168, 58, 31, 255]);
  assert.deepEqual(image.pixel(5, 6), [168, 58, 31, 255]);
}

// East and west use the same asymmetric, non-square stamp. East needs an explicit
// horizontal flip to match the physical reflection of the west face.
{
  const pixels = 'ab/cd/ef';
  const mappings = 'a = a; b = b; c = c; d = d; e = e; f = f;';
  const palette = 'a = #ff0000; b = #00ff00; c = #0000ff; d = #ffff00; e = #ff00ff; f = #00ffff;';
  const west = 'anchor = top_left; offset = (1px, 2px);';
  const reflected = render(source(west, 4, 0, pixels, mappings, palette, 5).replace(
    `face north { stamp eyes { ${west} } }`,
    'face west { stamp eyes { ' + west + ' } } face east { stamp eyes { anchor = top_right; offset = (-1px, 2px); flip = x; } }'));
  for (let row = 0; row < 3; row += 1) for (let column = 0; column < 2; column += 1) {
    assert.deepEqual(reflected.pixel(1 + column, 4 + 2 + row),
      reflected.pixel(8 + 2 - column, 4 + 2 + row));
  }
  const unchanged = render(source(west, 4, 0, pixels, mappings, palette, 5).replace(
    `face north { stamp eyes { ${west} } }`,
    'face west { stamp eyes { ' + west + ' } } face east { stamp eyes { anchor = top_right; offset = (-1px, 2px); } }'));
  assert.notDeepEqual(unchanged.pixel(1, 6), unchanged.pixel(10, 6));
}
