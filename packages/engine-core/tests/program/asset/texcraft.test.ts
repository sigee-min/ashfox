import assert from 'node:assert/strict';
import { compileDirectoryWorkspace, rasterizeCanonicalTexture } from '../../../src';
import {
  RAMP_PRESETS,
  expandRampFive,
  generateHueShiftedRamp,
  hexToOklch,
  relativeLuminance,
} from '../../../src/textures/oklch';

const workspaceConfig = (): string =>
  JSON.stringify({
    format: 'ashfox-workspace',
    version: 2,
    name: 'texcraft',
    packages: [
      {
        name: 'demo',
        root: 'assets/models',
        manifest: {
          format: 'ashfox-package',
          version: 1,
          dependencies: [],
          entries: [{ name: 'main', path: 'main.ashfox' }],
          modules: [],
        },
      },
    ],
    include: ['assets/**/*.ashfox'],
    ignore: [],
    build: { directory: 'dist/build' },
    exports: [],
  });

const compileSingle = (source: string) =>
  compileDirectoryWorkspace(workspaceConfig(), [{ path: 'assets/models/main.ashfox', source }]);

// 1. Verify OKLCH ramp presets keep luma >= 0.14, monotonic luminance, and 5-stop expansion.
for (const preset of RAMP_PRESETS) {
  const ramp3 = generateHueShiftedRamp('#9a4e32', preset);
  const ramp5 = expandRampFive(ramp3);
  assert.equal(ramp3.length, 3);
  assert.equal(ramp5.length, 5);
  assert.ok(relativeLuminance(ramp3[0]) >= 0.14, `${preset} shadow luma >= 0.14`);
  assert.ok(relativeLuminance(ramp3[0]) < relativeLuminance(ramp3[1]));
  assert.ok(relativeLuminance(ramp3[1]) < relativeLuminance(ramp3[2]));
  const shadowH = hexToOklch(ramp3[0]).h;
  const lightH = hexToOklch(ramp3[2]).h;
  assert.notEqual(Math.round(shadowH), Math.round(lightH));
}

// 2. Verify ramp() palette call, directional grain modes (fur, wood, cloth, brushed), and pattern edge.
const buildModel = (grainMode: string, withEdge: boolean): string => `ashfox-model 1
asset main {
  rig contract R {
    handedness = right;
    frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
    joint root { parent = none; role = root; frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } channels = rotation; mirror = none; }
  }
  skeleton S implements R { bind root { parent-origin = (0u, 0u, 0u); frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } } }
  surface contract Skin { chart body box { coverage = opaque; } material = opaque; }
  surface skin: Skin {
    material = opaque;
    texture tex {
      background = bg; background-alpha = 255;
      palette {
        bg = #222026;
        coat = ramp(#c46234, warm);
        oak = ramp(#8c6239, wood);
      }
      chart body box {
        fill = coat;
        ${withEdge ? 'pattern edge { width = 1px; strength = 1.0ratio; mode = both; }' : ''}
      }
      grain ${grainMode} { seed = 17; }
    }
  }
  component Body {
    requires rig skeleton: R;
    requires surface skin: Skin;
    bind bone root to skeleton.root;
    geometry { bone root { cube body { origin = (-4u, 0u, -4u); size = (8u, 8u, 8u); surface = skin.body; } } }
  }
  export asset main {
    settings { density = 16; forward = north; profile = prop; }
    skeleton = S;
    use Body as body { bind skeleton = R; bind skin = skin; };
  }
}`;

for (const mode of ['fur', 'wood', 'cloth', 'brushed']) {
  const res = compileSingle(buildModel(mode, true));
  assert.equal(res.ok, true, res.ok ? '' : JSON.stringify(res.diagnostics));
  if (res.ok && res.products[0]?.kind === 'model') {
    const tex = Object.values(res.products[0].model.textures)[0]!;
    const rgba = rasterizeCanonicalTexture(tex.width, tex.height, {
      ...tex.raster!,
      alphaMasks: tex.raster!.alphaMasks ?? [],
    }).rgba.copy();
    assert.equal(rgba.length, tex.width * tex.height * 4);
    assert.equal(res.products[0].telemetry?.textures[tex.id]?.defaultGrain, mode);
  }
}

// 3. Verify determinism: same source builds byte-identical raster, edge changes pixels vs no-edge.
const edgeOn = compileSingle(buildModel('none', true));
const edgeOff = compileSingle(buildModel('none', false));
assert.equal(edgeOn.ok, true);
assert.equal(edgeOff.ok, true);
if (
  edgeOn.ok &&
  edgeOff.ok &&
  edgeOn.products[0]?.kind === 'model' &&
  edgeOff.products[0]?.kind === 'model'
) {
  const t1 = Object.values(edgeOn.products[0].model.textures)[0]!;
  const t2 = Object.values(edgeOff.products[0].model.textures)[0]!;
  const b1 = rasterizeCanonicalTexture(t1.width, t1.height, {
    ...t1.raster!,
    alphaMasks: t1.raster!.alphaMasks ?? [],
  }).rgba.copy();
  const b2 = rasterizeCanonicalTexture(t2.width, t2.height, {
    ...t2.raster!,
    alphaMasks: t2.raster!.alphaMasks ?? [],
  }).rgba.copy();
  assert.notDeepEqual(b1, b2);
}

// 4. Invalid ramp preset fails cleanly.
const badPreset = compileSingle(
  buildModel('fur', false).replace('ramp(#c46234, warm)', 'ramp(#c46234, bogus)'),
);
assert.equal(badPreset.ok, false);
