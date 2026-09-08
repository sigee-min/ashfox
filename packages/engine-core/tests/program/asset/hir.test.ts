import assert from 'node:assert/strict';

import { buildAssetHir } from '../../../src/compiler/program/asset/hir';
import type { AssetHirResult } from '../../../src/compiler/program/asset/contract';
import { parseAssetSource } from '../../../src/project/program/asset/parse';
import {
  computePackageInterfaceHash,
  type AuthoredAssetWorkspace,
  type WorkspaceModuleAbi,
  withWorkspaceLimits
} from '../../../src/project/workspace';
import { makeIndexes, parseWorkspaceSources } from '../../../src/project/workspace/graphSource';
import { resolveWorkspaceEntryCompilation } from '../../../src/project/workspace/graph';
import { workspaceFixture } from '../../project/workspace/fixtures';

const frame = 'frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }';
const socketFrame = frame;

const rig = `ashfox-model 1
module rig {
  export socket contract WingMount { handedness = right; ${socketFrame} }
  export rig contract DragonRig {
    handedness = right; ${frame}
    joint root { parent = none; role = root; ${frame} channels = (rotation, scale); mirror = none; }
    joint chest { parent = root; role = chest; ${frame} channels = rotation; mirror = none; }
    socket wing: WingMount { joint = chest; capacity = many; ${frame} }
  }
  export skeleton Adult implements DragonRig {
    bind root { parent-origin = (0u, 0u, 0u); ${frame} }
    bind chest { parent-origin = (0u, 20u, 0u); ${frame} }
  }
  export motion idle for DragonRig {
    duration = 1s; fps = 24; loop = loop; rest-relative = true;
    track chest.rotation {
      key 0s = (0deg, 0deg, 0deg) linear;
      key 1s = (10deg, 0deg, 0deg) step;
    }
  }
}`;

const surface = `ashfox-model 1
module surface {
  export surface contract Skin {
    atlas { width = 64px; height = 64px; }
    chart body box { width = 16px; height = 16px; coverage = opaque; }
    material = cutout; slot tint: color;
  }
  export surface scales: Skin {
    material = cutout; slot tint = #ffffff;
    texture atlas { chart body box { origin = (0px, 0px); } }
  }
}`;

const body = `ashfox-model 1
module body {
  import "./rig.ashfox" as r; import "./surface.ashfox" as s;
  export component Body {
    param length: unit;
    requires rig skeleton: r.DragonRig;
    requires surface skin: s.Skin;
    provides socket child: r.WingMount capacity = many;
    bind bone root to skeleton.root;
    bind socket child to bone root { ${frame} }
    geometry { bone root {
      cube body { origin = (0u, 0u, 0u); size = (12u, 12u, 12u); surface = skin.body; }
      bone private { cube detail { origin = (1u, 1u, 1u); size = (2u, 2u, 2u); surface = skin.body; } }
    } }
  }
}`;

const mount = `ashfox-model 1
module mount {
  import "./rig.ashfox" as r; import "./surface.ashfox" as s;
  export component Mount {
    requires surface skin: s.Skin; requires socket wing: r.WingMount;
    bind socket wing to bone anchor { frame { origin = (2u, 0u, 0u); x = (0, 1, 0); y = (-1, 0, 0); z = (0, 0, 1); } }
    geometry { bone anchor { cube plate { origin = (0u, 0u, 0u); size = (4u, 4u, 4u); surface = skin.body; } } }
  }
}`;

const root = `ashfox-model 1
asset package {
  import "./rig.ashfox" as r; import "./surface.ashfox" as s;
  import "./body.ashfox" as b; import "./mount.ashfox" as m;
  export asset boss {
    settings { density = 16; forward = north; }
    skeleton = r.Adult; motion = r.idle;
    use b.Body as body { set length = 4u; bind skeleton = r.DragonRig; bind skin = s.scales; };
    use m.Mount as mount { bind skin = s.scales; };
    connect skeleton.wing -> mount.wing;
  }
}`;

const modulePaths = [
  { subpath: './rig', path: 'rig.ashfox' },
  { subpath: './surface', path: 'surface.ashfox' },
  { subpath: './body', path: 'body.ashfox' },
  { subpath: './mount', path: 'mount.ashfox' }
] as const;

const workspaceFor = (
  rootSource: string,
  overrides: Readonly<Record<string, string>> = {}
): AuthoredAssetWorkspace => {
  const workspace = workspaceFixture([
    { path: 'dragon/main.ashfox', source: rootSource.replace('asset package {', 'asset boss {') },
    { path: 'dragon/rig.ashfox', source: overrides.rig ?? rig },
    { path: 'dragon/surface.ashfox', source: overrides.surface ?? surface },
    { path: 'dragon/body.ashfox', source: overrides.body ?? body },
    { path: 'dragon/mount.ashfox', source: overrides.mount ?? mount }
  ], { root: 'dragon', packageName: 'dragon', entries: [{ name: 'boss', path: 'main.ashfox' }], modules: modulePaths });
  const indexes = makeIndexes(workspace);
  const states = parseWorkspaceSources(indexes, [], withWorkspaceLimits(undefined));
  const pkg = workspace.manifest.packages[0]!;
  const abis: WorkspaceModuleAbi[] = [];
  for (const module of pkg.manifest.modules) {
    const parsed = states?.get(`${pkg.name}\u0000${pkg.root}/${module.path}`)?.abi;
    if (parsed !== undefined) abis.push({ ...parsed, subpath: module.subpath });
  }
  const locked = workspace.lock.packages[0]!;
  return { ...workspace, lock: { ...workspace.lock, packages: [{ ...locked, interfaceHash: computePackageInterfaceHash(pkg, abis) }] } };
};

const compileWorkspace = (workspace: AuthoredAssetWorkspace): AssetHirResult => {
  const resolved = resolveWorkspaceEntryCompilation(workspace, { packageName: 'dragon', entryName: 'boss' });
  if (!resolved.ok) throw new Error(resolved.diagnostics.map((item) => item.code).join(', '));
  return buildAssetHir(resolved.value.closure);
};

const expectCode = (result: AssetHirResult, code: string): void => {
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.diagnostics.some((item) => item.code === code),
    `${code}: ${result.diagnostics.map((item) => item.code).join(', ')}`);
};

const parserCode = (source: string, code: string): void => {
  assert.ok(parseAssetSource(source).diagnostics.some((item) => item.code === code), code);
};

const baseline = compileWorkspace(workspaceFor(root));
assert.equal(baseline.ok, true, baseline.ok ? '' : baseline.diagnostics.map((item) => item.code).join(', '));
if (baseline.ok) {
  const texture = Object.values(baseline.hir.surfaces)[0]!.textureSource!;
  assert.ok(Object.isFrozen(baseline.hir));
  assert.ok(Object.isFrozen(texture));
  assert.ok(Object.isFrozen(texture.payload));
  assert.ok(Object.isFrozen(texture.payload.statements));
  assert.ok(Object.isFrozen(texture.payload.statements[0]!));
  const reversed = { ...workspaceFor(root), files: [...workspaceFor(root).files].reverse() };
  const reordered = compileWorkspace(reversed);
  assert.equal(reordered.ok, true);
  if (reordered.ok) {
    assert.deepEqual(Object.keys(reordered.hir.symbols), Object.keys(baseline.hir.symbols));
    assert.deepEqual(Object.keys(reordered.hir.modules), Object.keys(baseline.hir.modules));
    assert.deepEqual(Object.values(reordered.hir.modules).map((item) => item.declarations),
      Object.values(baseline.hir.modules).map((item) => item.declarations));
  }
}

parserCode(root.replace('density = 16;', 'density = 16; extra = 1;'), 'asset.invalid-property');
parserCode(surface.replace('material = cutout;', 'material = cutout; material = cutout;'), 'asset.duplicate-material');
parserCode(rig.replace('handedness = right; ' + socketFrame,
  'handedness = right; handedness = left; ' + socketFrame), 'asset.duplicate-property');

const nonzeroSocketContract = rig.replace(socketFrame,
  'frame { origin = (1u, 0u, 0u); x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }');
expectCode(compileWorkspace(workspaceFor(root, { rig: nonzeroSocketContract })), 'asset.socket-contract-origin');

const conflictingBind = rig.replace(`bind root { parent-origin = (0u, 0u, 0u); ${frame} }`,
  'bind root { parent-origin = (0u, 0u, 0u); frame { origin = (1u, 0u, 0u); x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } }');
expectCode(compileWorkspace(workspaceFor(root, { rig: conflictingBind })), 'asset.duplicate-frame-origin');

const mirrored = rig
  .replace('mirror = none; }\n    joint chest', 'mirror = chest; }\n    joint chest')
  .replace('channels = rotation; mirror = none;', 'channels = rotation; mirror = root;');
expectCode(compileWorkspace(workspaceFor(root, { rig: mirrored })), 'asset.mirror-channel-mismatch');

const longMotion = rig.replace('duration = 1s;', 'duration = 1000s;').replace('fps = 24;', 'fps = 240;');
expectCode(compileWorkspace(workspaceFor(root, { rig: longMotion })), 'asset.motion-frame-limit');

const scaleMotion = rig.replace('channels = rotation;', 'channels = scale;')
  .replace('track chest.rotation', 'track chest.scale')
  .replace('(0deg, 0deg, 0deg)', '(1ratio, 1ratio, 1ratio)')
  .replace('(10deg, 0deg, 0deg)', '(0ratio, 1ratio, 1ratio)');
expectCode(compileWorkspace(workspaceFor(root, { rig: scaleMotion })), 'asset.invalid-motion-scale');

const privateEndpoint = body.replace('bind socket child to bone root', 'bind socket child to bone private');
expectCode(compileWorkspace(workspaceFor(root, { body: privateEndpoint })), 'asset.socket-placement-authority');

const transformedAnchor = mount.replace('bone anchor { cube plate',
  'bone anchor { position = (1u, 0u, 0u); cube plate');
expectCode(compileWorkspace(workspaceFor(root, { mount: transformedAnchor })), 'asset.bound-bone-transform');

const cubeOffset = body.replace('cube body { origin', 'cube body { offset = (1u, 1u); origin');
expectCode(compileWorkspace(workspaceFor(root, { body: cubeOffset })), 'asset.invalid-geometry-property');

const nestedCube = body.replace('cube body { origin',
  'cube body { cube hidden { origin = (0u, 0u, 0u); size = (1u, 1u, 1u); surface = skin.body; } origin');
expectCode(compileWorkspace(workspaceFor(root, { body: nestedCube })), 'asset.invalid-geometry-scope');

const duplicateFace = body.replace('surface = skin.body; }',
  'surface = skin.body; face north {} face north {} }');
expectCode(compileWorkspace(workspaceFor(root, { body: duplicateFace })), 'asset.duplicate-geometry-face');

const extraRootAsset = root.replace('  }\n}', '  }\n  asset private {}\n}');
expectCode(compileWorkspace(workspaceFor(extraRootAsset)), 'asset.root-export');
