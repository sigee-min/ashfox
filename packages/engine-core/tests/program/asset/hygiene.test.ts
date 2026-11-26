import assert from 'node:assert/strict';
import { compileDirectoryWorkspace } from '../../../src';

const compileFiles = (entry: string, files: readonly { path: string; source: string }[]) => {
  const entryFile = files.find((f) => f.path === entry);
  const entryMatch = entryFile?.source.match(/\bmodel\s+(\S+)/u);
  const entryName = entryMatch?.[1] ?? 'hygiene';
  const cfg = JSON.stringify({
    format: 'ashfox-workspace',
    version: 2,
    name: 'hygiene',
    packages: [
      {
        name: 'hygiene',
        root: 'assets/models',
        manifest: {
          format: 'ashfox-package',
          version: 1,
          dependencies: [],
          entries: [{ name: entryName, path: entry }],
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
  return compileDirectoryWorkspace(
    cfg,
    files.map((f) => ({ path: `assets/models/${f.path}`, source: f.source })),
  );
};

const diagnosticCodes = (result: ReturnType<typeof compileFiles>): string[] => {
  if (result.ok) return [];
  const codes: string[] = [];
  for (const d of result.diagnostics) {
    codes.push(d.code);
    if (!d.message.startsWith('[')) continue;
    try {
      const parsed = JSON.parse(d.message) as Array<{ code?: string }>;
      for (const inner of parsed) {
        if (inner.code) codes.push(inner.code);
      }
    } catch {
      // ignore non-json message
    }
  }
  return codes;
};

const minRig = `  rig contract R {
    handedness = right;
    frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
    joint root { parent = none; role = root; frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } channels = rotation; mirror = none; }
  }
  skeleton Skel implements R {
    bind root { parent_origin = (0u, 0u, 0u); frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } }
  }`;

const surfaceModule = `ashfox 1
module mat {
  export surface contract S { chart body box { coverage = opaque; } material = opaque; }
  export surface Clean: S {
    material = opaque;
    texture atlas {
      atlas = (32px, 32px);
      density = 1;
      background = base;
      background_alpha = 255;
      palette { base = (#556677, #778899, #99aabb); trim = (#445566, #778899, #aabbcc); }
      chart body box {
        fill = base;
        grain = none;
        pattern border { paint = trim; width = 1px; edges = all; }
      }
      tone painterly;
    }
  }
}`;

const rigModule = `ashfox 1
module rigmod {
  export rig contract R {
    handedness = right;
    frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
    joint root { parent = none; role = root; frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } channels = rotation; mirror = none; }
  }
  export skeleton Skel implements R {
    bind root { parent_origin = (0u, 0u, 0u); frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } }
  }
}`;

const bodyModule = `ashfox 1
module geom {
  import "./mat.ashfox" as mat;
  import "./rigmod.ashfox" as rigmod;
  export component BoxPart {
    requires rig skel: rigmod.R;
    requires surface skin: mat.S;
    bind bone root to skel.root;
    geometry {
      bone root {
        cube main { origin = (-2u, 0u, -2u); size = (4u, 4u, 4u); surface = skin.body; }
      }
    }
  }
}`;

const validMain = `ashfox 1
model prop_ok {
  import "./mat.ashfox" as mat;
${minRig}
  component LocalBox {
    requires rig skel: R;
    requires surface skin: mat.S;
    bind bone root to skel.root;
    geometry {
      bone root {
        cube main { origin = (-2u, 0u, -2u); size = (4u, 4u, 4u); surface = skin.body; }
      }
    }
  }
  settings { density = 16; forward = north; profile = prop; }
    skeleton = Skel;
    use LocalBox as box { skel = R; skin = mat.Clean; }
}`;

const unusedImportMain = validMain.replace(
  '  import "./mat.ashfox" as mat;',
  '  import "./mat.ashfox" as mat;\n  import "./extra.ashfox" as extra;',
);

const unusedDeclMain = validMain.replace(
  '  component LocalBox {',
  `  surface contract UnusedContract { chart x box { coverage = opaque; } material = opaque; }\n  component LocalBox {`,
);

const unusedStampSource = `ashfox 1
model stamp_bad {
${minRig}
  surface contract S { chart c box { coverage = opaque; } material = opaque; }
  surface Stone: S {
    material = opaque;
    texture atlas {
      atlas = (64px, 64px);
      density = 1;
      background = base;
      background_alpha = 255;
      palette { base = (#444444, #666666, #888888); hi = (#555555, #888888, #bbbbbb); }
      stamp unused_mark { pixels = "h"; h = hi; }
      chart c box {
        fill = base;
        grain = none;
        pattern border { paint = hi; width = 1px; edges = all; }
      }
      tone painterly;
    }
  }
  component Body {
    requires rig skel: R;
    requires surface skin: S;
    bind bone root to skel.root;
    geometry { bone root { cube c { origin = (-2u, 0u, -2u); size = (4u, 4u, 4u); surface = skin.c; } } }
  }
  settings { density = 16; forward = north; profile = block; }
    skeleton = Skel;
    use Body as body { skel = R; skin = Stone; }
}`;

const creatureCubeLines = (count: number): string =>
  Array.from(
    { length: count },
    (_, i) =>
      `        cube p${i} { origin = (-2u, ${i}u, -2u); size = (4u, 1u, 4u); surface = skin.c; }`,
  ).join('\n');

const monolithicCreatureMain = `ashfox 1
model big_creature {
${minRig}
  surface contract S { chart c box { coverage = opaque; } material = opaque; }
  surface Coat: S {
    material = opaque;
    texture atlas {
      atlas = (128px, 128px);
      density = 1;
      background = base;
      background_alpha = 255;
      palette { base = (#663311, #885533, #aa7755); hi = (#774422, #aa7744, #ddaa77); }
      chart c box { fill = base; grain = none; pattern border { paint = hi; width = 1px; edges = all; } }
      tone painterly;
    }
  }
  component Body {
    requires rig skel: R;
    requires surface skin: S;
    bind bone root to skel.root;
    geometry {
      bone root {
${creatureCubeLines(20)}
      }
    }
  }
  settings { density = 16; forward = north; profile = creature; }
    skeleton = Skel;
    use Body as body { skel = R; skin = Coat; }
}`;

const mixedModule = `ashfox 1
module mixed {
  export rig contract R {
    handedness = right;
    frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
    joint root { parent = none; role = root; frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } channels = rotation; mirror = none; }
  }
  export skeleton Skel implements R {
    bind root { parent_origin = (0u, 0u, 0u); frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } }
  }
  export surface contract S { chart c box { coverage = opaque; } material = opaque; }
  export surface Mat: S {
    material = opaque;
    texture atlas {
      atlas = (32px, 32px);
      density = 1;
      background = base;
      background_alpha = 255;
      palette { base = (#555555, #777777, #999999); }
      chart c box { fill = base; grain = none; }
      tone painterly;
    }
  }
  export component Part {
    requires rig skel: R;
    requires surface skin: S;
    bind bone root to skel.root;
    geometry { bone root { cube c { origin = (-2u, 0u, -2u); size = (4u, 4u, 4u); surface = skin.c; } } }
  }
}`;

const mixedEntry = `ashfox 1
model uses_mixed {
  import "./mixed.ashfox" as m;
  settings { density = 16; forward = north; profile = prop; }
    skeleton = m.Skel;
    use m.Part as p { skel = m.R; skin = m.Mat; }
}`;

const modularOk = compileFiles('main.ashfox', [
  { path: 'mat.ashfox', source: surfaceModule },
  { path: 'main.ashfox', source: validMain },
]);
assert.equal(
  modularOk.ok,
  true,
  `valid modular workspace failed: ${modularOk.ok ? '' : JSON.stringify(modularOk.diagnostics)}`,
);

const unusedImportRes = compileFiles('main.ashfox', [
  { path: 'mat.ashfox', source: surfaceModule },
  { path: 'rigmod.ashfox', source: rigModule },
  { path: 'extra.ashfox', source: bodyModule },
  { path: 'main.ashfox', source: unusedImportMain },
]);
assert.ok(diagnosticCodes(unusedImportRes).includes('asset.unused-import'));

const unusedDeclRes = compileFiles('main.ashfox', [
  { path: 'mat.ashfox', source: surfaceModule },
  { path: 'main.ashfox', source: unusedDeclMain },
]);
assert.ok(diagnosticCodes(unusedDeclRes).includes('asset.unused-declaration'));

const unusedStampRes = compileFiles('main.ashfox', [
  { path: 'main.ashfox', source: unusedStampSource },
]);
assert.ok(diagnosticCodes(unusedStampRes).includes('asset.texture.unused-stamp'));

const monolithicRes = compileFiles('main.ashfox', [
  { path: 'main.ashfox', source: monolithicCreatureMain },
]);
assert.ok(diagnosticCodes(monolithicRes).includes('asset.monolithic-entry'));

const mixedModuleRes = compileFiles('main.ashfox', [
  { path: 'mixed.ashfox', source: mixedModule },
  { path: 'main.ashfox', source: mixedEntry },
]);
assert.ok(diagnosticCodes(mixedModuleRes).includes('asset.mixed-module-concerns'));

console.log('hygiene ok: all 5 compile-time rules verified');
