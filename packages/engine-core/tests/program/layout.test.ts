import assert from 'node:assert/strict';
import { compileDirectoryWorkspace } from '../../src';

const spriteSource = (id: string, importSpec = ''): string => `ashfox 1
sprite ${id} {
  ${importSpec ? `import "${importSpec}" as shared;` : ''}
  profile = item;
  canvas = (16px, 16px);
  palette { c = #cccccc; }
  ${
    importSpec
      ? 'part p { mask = shared.m; material = shared.g; at = (4px, 4px); shade { form = round; light = top_left; contrast = 2; } grain clustered { amount = 0; seed = 7; } patches = []; }'
      : 'paint p { at = (4px, 4px); rows = ["cccc", "cccc"]; colors { c = c; } }'
  }
}`;

const sharedSpriteModule = `ashfox 1
module shared {
  export mask m { rows = ["11111111", "11111111", "11111111", "11111111", "11111111", "11111111", "11111111", "11111111"]; }
  export material g { ramp { mode = explicit; colors = [#333333, #777777, #cccccc]; } }
}`;

const workspace = (
  name: string,
  root: string,
  entries: readonly { readonly name: string; readonly path: string }[],
  modules: readonly { readonly subpath: string; readonly path: string }[],
  include: readonly string[] = ['assets/**/*.ashfox'],
): string =>
  JSON.stringify({
    format: 'ashfox-workspace',
    version: 2,
    name,
    packages: [
      {
        name: 'pkg',
        root,
        manifest: { format: 'ashfox-package', version: 1, entries, modules, dependencies: [] },
      },
    ],
    include,
    ignore: [],
    build: { directory: 'dist/build' },
    exports: [],
  });

// 1. layout.root: non-canonical folder outside assets/{models,sprites,sounds,structures,module}/ rejected.
const outsideRoot = compileDirectoryWorkspace(
  workspace('proj', 'src', [{ name: 'a', path: 'a.ashfox' }], [], ['src/**/*.ashfox']),
  [{ path: 'src/a.ashfox', source: spriteSource('a') }],
);
assert.equal(outsideRoot.ok, false);
assert.match(outsideRoot.diagnostics[0]!.message, /layout\.root/);

// 2. layout.kind-mismatch: sprite entry under assets/models/ rejected.
const kindMismatch = compileDirectoryWorkspace(
  workspace('proj', 'assets', [{ name: 'a', path: 'models/a.ashfox' }], []),
  [{ path: 'assets/models/a.ashfox', source: spriteSource('a') }],
);
assert.equal(kindMismatch.ok, false);
assert.match(kindMismatch.diagnostics[0]!.message, /layout\.kind-mismatch/);

// 3. layout.module-only: entry file placed under assets/module/ rejected.
const entryInModule = compileDirectoryWorkspace(
  workspace('proj', 'assets', [{ name: 'a', path: 'module/a.ashfox' }], []),
  [{ path: 'assets/module/a.ashfox', source: spriteSource('a') }],
);
assert.equal(entryInModule.ok, false);
assert.match(entryInModule.diagnostics[0]!.message, /layout\.module-only/);

// 4. layout.shared-in-module: module imported by 2+ entries must live under assets/module/.
const sharedOutsideModule = compileDirectoryWorkspace(
  workspace(
    'proj',
    'assets',
    [
      { name: 'a', path: 'sprites/a.ashfox' },
      { name: 'b', path: 'sprites/b.ashfox' },
    ],
    [{ subpath: './shared', path: 'sprites/shared.ashfox' }],
  ),
  [
    { path: 'assets/sprites/a.ashfox', source: spriteSource('a', './shared.ashfox') },
    { path: 'assets/sprites/b.ashfox', source: spriteSource('b', './shared.ashfox') },
    { path: 'assets/sprites/shared.ashfox', source: sharedSpriteModule },
  ],
);
assert.equal(sharedOutsideModule.ok, false);
assert.match(sharedOutsideModule.diagnostics[0]!.message, /layout\.shared-in-module/);

// 5. Canonical placement in assets/module/ succeeds cleanly.
const sharedInModule = compileDirectoryWorkspace(
  workspace(
    'proj',
    'assets',
    [
      { name: 'a', path: 'sprites/a.ashfox' },
      { name: 'b', path: 'sprites/b.ashfox' },
    ],
    [{ subpath: './shared', path: 'module/shared.ashfox' }],
  ),
  [
    { path: 'assets/sprites/a.ashfox', source: spriteSource('a', '../module/shared.ashfox') },
    { path: 'assets/sprites/b.ashfox', source: spriteSource('b', '../module/shared.ashfox') },
    { path: 'assets/module/shared.ashfox', source: sharedSpriteModule },
  ],
);
assert.equal(
  sharedInModule.ok,
  true,
  sharedInModule.ok ? '' : JSON.stringify(sharedInModule.diagnostics),
);

// 6. Standalone workspace exemption allows root-relative single-file fixtures.
const standaloneOk = compileDirectoryWorkspace(
  workspace('standalone', '', [{ name: 'a', path: 'a.ashfox' }], [], ['**/*.ashfox']),
  [{ path: 'a.ashfox', source: spriteSource('a') }],
);
assert.equal(
  standaloneOk.ok,
  true,
  standaloneOk.ok ? '' : JSON.stringify(standaloneOk.diagnostics),
);

console.log('canonical boilerplate layout rules ok');
