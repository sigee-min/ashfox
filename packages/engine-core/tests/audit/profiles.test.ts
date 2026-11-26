import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { compileDirectoryWorkspace, evaluateAssetQuality, type AuditReport } from '../../src';

const repoRoot = path.resolve(__dirname, '../../../..');

const loadWorkspaceFiles = (dir: string, rootDir = dir): { path: string; source: string }[] => {
  const out: { path: string; source: string }[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...loadWorkspaceFiles(abs, rootDir));
    else if (entry.name.endsWith('.ashfox')) {
      out.push({
        path: path.relative(rootDir, abs).replace(/\\/g, '/'),
        source: fs.readFileSync(abs, 'utf8'),
      });
    }
  }
  return out;
};

const makeWorkspaceConfig = (
  name: string,
  entry: string,
  files: readonly { path: string }[],
): string =>
  JSON.stringify({
    format: 'ashfox-workspace',
    version: 2,
    name,
    packages: [
      {
        name: 'standalone',
        root: 'assets/models',
        manifest: {
          format: 'ashfox-package',
          version: 1,
          dependencies: [],
          entries: [{ name, path: entry }],
          modules: files
            .filter((f) => f.path !== entry)
            .map((f) => ({ path: f.path, subpath: `./${f.path.replace(/\.ashfox$/u, '')}` })),
        },
      },
    ],
    include: ['assets/**/*.ashfox'],
    ignore: [],
    build: { directory: 'dist/build' },
    exports: [],
  });

const evaluateRepoAsset = (entryRelPath: string, workspaceDir?: string): AuditReport => {
  const absEntry = path.join(repoRoot, entryRelPath);
  const absDir = workspaceDir ? path.join(repoRoot, workspaceDir) : path.dirname(absEntry);
  const entry = path.relative(absDir, absEntry).replace(/\\/g, '/');
  const rawFiles = workspaceDir
    ? loadWorkspaceFiles(absDir)
    : [{ path: entry, source: fs.readFileSync(absEntry, 'utf8') }];
  const pkgFiles = rawFiles.map((f) => ({ path: `assets/models/${f.path}`, source: f.source }));
  const entryMatch = rawFiles.find((f) => f.path === entry)?.source.match(/\bmodel\s+(\S+)/u);
  const assetName = entryMatch?.[1] ?? path.basename(entry, '.ashfox');
  const compiled = compileDirectoryWorkspace(
    makeWorkspaceConfig(assetName, entry, rawFiles),
    pkgFiles,
  );
  assert.equal(
    compiled.ok,
    true,
    `${entryRelPath} failed: ${compiled.ok ? '' : JSON.stringify(compiled.diagnostics)}`,
  );
  const product = compiled.products.find((p) => p.kind === 'model');
  assert.ok(product && product.kind === 'model', `No model product for ${entryRelPath}`);
  return evaluateAssetQuality({ model: product.model, telemetry: product.telemetry });
};

const evaluateInline = (source: string): AuditReport => {
  const entryMatch = source.match(/\bmodel\s+(\S+)/u);
  const name = entryMatch?.[1] ?? 'inline';
  const compiled = compileDirectoryWorkspace(
    makeWorkspaceConfig(name, 'main.ashfox', [{ path: 'main.ashfox' }]),
    [{ path: 'assets/models/main.ashfox', source }],
  );
  assert.equal(
    compiled.ok,
    true,
    `inline fixture failed: ${compiled.ok ? '' : JSON.stringify(compiled.diagnostics)}`,
  );
  const product = compiled.products.find((p) => p.kind === 'model');
  assert.ok(product && product.kind === 'model');
  return evaluateAssetQuality({ model: product.model, telemetry: product.telemetry });
};

const metricScore = (report: AuditReport, id: string) => {
  for (const pillar of report.pillars) {
    const metric = pillar.metrics.find((m) => m.id === id);
    if (metric) return metric;
  }
  throw new Error(`Missing metric ${id}`);
};

const minRig = `  rig contract R {
    handedness = right;
    frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
    joint root { parent = none; role = root; frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } channels = rotation; mirror = none; }
  }
  skeleton Skel implements R {
    bind root { parent_origin = (0u, 0u, 0u); frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } }
  }`;

const blockSingleSource = (densePattern: boolean): string => `ashfox 1
model test_block {
${minRig}
  settings { density = 16; forward = north; profile = block; }
    skeleton = Skel;
    use Body as body { skel = R; skin = Stone; }
  surface contract Surface { chart block box { coverage = opaque; } material = opaque; }
  surface Stone: Surface {
    material = opaque;
    texture atlas {
      atlas = (64px, 64px);
      density = 1;
      background = base;
      background_alpha = 255;
      palette {
        base = (#51565e, #7c828a, #aeb5bf);
        trim = (#3f444c, #5f6670, #c2c8d1);
        moss = (#3a592b, #5b8242, #87b563);
      }
      stamp crest { pixels = ".mm./mmmm/.mm."; m = moss; }
      chart block box {
        fill = base;
        grain = clustered;
        pattern border { paint = trim; width = 1px; edges = all; }
        ${densePattern ? 'pattern stripe { paint = trim; axis = y; period = 2px; width = 1px; phase = 0; }\n        pattern gradient { from = trim; to = moss; axis = y; space = local; soft = 0.25; }' : ''}
        pattern ao { strength = 0.25; radius = 0.5u; }
        face north { stamp crest { at = (5px, 6px); protect = true; } }
      }
      grain clustered { seed = 101; }
      tone painterly;
    }
  }
  component Body {
    requires rig skel: R;
    requires surface skin: Surface;
    bind bone root to skel.root;
    geometry {
      bone root {
        cube main { origin = (-8u, 0u, -8u); size = (16u, 16u, 16u); surface = skin.block; }
      }
    }
  }
}`;

const asymmetricPropSource = `ashfox 1
model desk_lamp {
${minRig}
  settings { density = 16; forward = north; profile = prop; }
    skeleton = Skel;
    use Lamp as lamp { skel = R; skin = Brass; }
  surface contract Surface {
    chart base box { coverage = opaque; }
    chart arm box { coverage = opaque; }
    chart top_arm box { coverage = opaque; }
    chart shade box { coverage = opaque; }
    material = opaque;
  }
  surface Brass: Surface {
    material = opaque;
    texture atlas {
      atlas = (128px, 128px);
      density = 2;
      background = brass;
      background_alpha = 255;
      palette {
        brass = (#6b4a17, #a87528, #ebc063);
        glow = (#cc7a19, #ffa833, #ffeb99);
      }
      chart base box {
        fill = brass;
        grain = none;
        pattern border { paint = glow; width = 1px; edges = top; }
        pattern ao { strength = 0.3; radius = 0.5u; }
      }
      chart arm box {
        fill = brass;
        grain = none;
        pattern border { paint = glow; width = 1px; edges = top; }
        pattern ao { strength = 0.3; radius = 0.5u; }
      }
      chart top_arm box {
        fill = brass;
        grain = none;
        pattern border { paint = glow; width = 1px; edges = top; }
        pattern ao { strength = 0.3; radius = 0.5u; }
      }
      chart shade box {
        fill = brass;
        grain = none;
        pattern border { paint = glow; width = 1px; edges = top; }
        pattern ao { strength = 0.3; radius = 0.5u; }
      }
      tone painterly;
    }
  }
  component Lamp {
    requires rig skel: R;
    requires surface skin: Surface;
    bind bone root to skel.root;
    geometry {
      bone root {
        cube base { origin = (-3u, 0u, -3u); size = (6u, 1u, 6u); surface = skin.base; }
        cube arm { origin = (-3u, 1u, -1u); size = (2u, 6u, 2u); surface = skin.arm; }
        cube top_arm { origin = (-3u, 7u, -1u); size = (6u, 2u, 2u); pivot = (-2u, 7u, 0u); rotation = (0deg, 0deg, 22.5deg); surface = skin.top_arm; }
        cube shade { origin = (1u, 6u, -2u); size = (4u, 3u, 4u); surface = skin.shade; }
      }
    }
  }
}`;

const runeBricks = evaluateRepoAsset('examples/block/rune_bricks.ashfox');
assert.equal(runeBricks.profile, 'block');
assert.equal(runeBricks.passed, true);
assert.ok(runeBricks.score >= 85, `expected rune_bricks >= 85, got ${runeBricks.score}`);
assert.equal(metricScore(runeBricks, 'rig.rigAndMotion').score, 4);

const marker = evaluateRepoAsset('examples/minecraft/assets/models/marker.ashfox');
assert.equal(marker.profile, 'block');
assert.equal(marker.passed, true);
assert.ok(marker.score >= 85, `expected marker >= 85, got ${marker.score}`);

const lantern = evaluateRepoAsset('examples/prop/lantern.ashfox');
assert.equal(lantern.profile, 'prop');
assert.equal(lantern.passed, true);
assert.ok(lantern.score >= 85, `expected lantern >= 85, got ${lantern.score}`);

const chest = evaluateRepoAsset(
  'examples/prop/treasure_chest/chest.ashfox',
  'examples/prop/treasure_chest',
);
assert.equal(chest.profile, 'prop');
assert.equal(chest.passed, true);
assert.ok(chest.score >= 85, `expected treasure_chest >= 85, got ${chest.score}`);

const asymProp = evaluateInline(asymmetricPropSource);
assert.equal(asymProp.profile, 'prop');
assert.equal(metricScore(asymProp, 'rig.rigAndMotion').score, 4);
assert.ok(
  !asymProp.topDeductions.some((d) => /symmetry/i.test(d.summary)),
  'asymmetric prop should not receive front-symmetry penalty',
);

const calmBlock = evaluateInline(blockSingleSource(false));
assert.equal(metricScore(calmBlock, 'rig.rigAndMotion').score, 4);
assert.ok(
  !calmBlock.topDeductions.some((d) => /overly busy/i.test(d.summary)),
  'calm block should not trigger overly-busy deduction',
);

const busyBlock = evaluateInline(blockSingleSource(true));
assert.ok(
  busyBlock.topDeductions.some((d) => /overly busy/i.test(d.summary)),
  'over-patterned block (>68% pre-grain delta) should report overly-busy deduction',
);

console.log(
  `profiles ok: rune_bricks=${runeBricks.score} marker=${marker.score} lantern=${lantern.score} chest=${chest.score}`,
);
