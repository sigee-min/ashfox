import assert from 'node:assert/strict';
import { compileAssetWorkspaceEntry } from '../../../src';
import { rasterizeCanonicalTexture } from '../../../src/textures/textureRecipe/raster';
import { VALID_ASSET_SOURCE, validAssetWorkspace } from './fixture';

const source = (placement: string, width = 4, atlasX = 0, pixels = 'aa/aa') =>
  VALID_ASSET_SOURCE
    .replace('width = 16px; height = 8px;', 'width = 64px; height = 16px;')
    .replace('chart body box { width = 16px;', `chart body box { width = ${width * 2 + 8}px;`)
    .replace('atlas = (16px, 8px);', 'atlas = (64px, 16px);')
    .replace('palette { shadow', 'palette { eye = #00ff00; shadow')
    .replace('chart body box { origin = (0px, 0px); fill = body; }',
      `stamp eyes { pixels = "${pixels}"; a = eye; }
      chart body box { origin = (${atlasX}px, 0px); fill = body;
        face north { stamp eyes { ${placement} } }
      }`)
    .replace('size = (4u, 4u, 4u);', `size = (${width}u, 4u, 4u);`);

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
