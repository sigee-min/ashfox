import assert from 'node:assert/strict';

import { buildAssetHir } from '../../../src/compiler/program/asset/hir';
import { instantiateAsset } from '../../../src/compiler/program/asset/instantiate';
import type { AssetHirResult } from '../../../src/compiler/program/asset/contract';
import { parseAssetSource } from '../../../src/project/program/asset/parse';
import { sourceSpan } from '../../../src/project/source/lexer';
import {
  computePackageInterfaceHash,
  type AuthoredAssetWorkspace,
  type WorkspaceModuleAbi,
  type WorkspaceDiagnostic,
  withWorkspaceLimits
} from '../../../src/project/workspace';
import { makeIndexes, parseWorkspaceSources } from '../../../src/project/workspace/graphSource';
import { resolveWorkspaceEntryCompilation } from '../../../src/project/workspace/graph';
import {
  workspaceFixture
} from '../../project/workspace/fixtures';

const frame = 'frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }';
// A concrete endpoint may choose a different local origin and basis while
// retaining the socket contract's declared handedness.
const localSocketFrame = 'frame { origin = (2u, 0u, 0u); x = (0, 1, 0); y = (-1, 0, 0); z = (0, 0, 1); }';

const rig = `ashfox-model 1
module rig {
  export socket contract WingMount {
    handedness = right;
    ${frame}
  }
  export rig contract DragonRig {
    handedness = right;
    ${frame}
    joint root { parent = none; role = root; ${frame} channels = (rotation, scale); mirror = none; }
    joint chest { parent = root; role = chest; ${frame} channels = rotation; mirror = none; }
    socket wing: WingMount { joint = chest; capacity = many; ${frame} }
  }
  export skeleton Adult implements DragonRig {
    bind root { parent-origin = (0u, 0u, 0u); ${frame} }
    bind chest { parent-origin = (0u, 20u, 0u); ${frame} }
  }
  export motion idle for DragonRig {
    duration = 1s;
    fps = 24;
    loop = loop;
    rest-relative = true;
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
    material = cutout;
    slot tint: color;
  }
  export surface scales: Skin {
    material = cutout;
    slot tint = #ffffff;
    texture atlas {
      chart body box { origin = (0px, 0px); }
    }
  }
}`;

const body = `ashfox-model 1
module body {
  import "./rig.ashfox" as r;
  import "./surface.ashfox" as s;
  export component Body {
    param length: unit;
    requires rig skeleton: r.DragonRig;
    requires surface skin: s.Skin;
    provides socket child: r.WingMount capacity = many;
    bind bone root to skeleton.root;
    bind socket child to bone root { ${frame} }
    geometry {
      bone root {
        cube body {
          origin = (0u, 0u, 0u);
          size = (12u, 12u, 12u);
          surface = skin.body;
        }
        bone private {
          cube detail { origin = (1u, 1u, 1u); size = (2u, 2u, 2u); surface = skin.body; }
        }
      }
    }
  }
}`;

const mount = `ashfox-model 1
module mount {
  import "./rig.ashfox" as r;
  import "./surface.ashfox" as s;
  export component Mount {
    requires surface skin: s.Skin;
    requires socket wing: r.WingMount;
    bind socket wing to bone anchor { ${localSocketFrame} }
    geometry {
      bone anchor {
        cube plate { origin = (0u, 0u, 0u); size = (4u, 4u, 4u); surface = skin.body; }
      }
    }
  }
}`;

const root = `ashfox-model 1
asset package {
  import "./rig.ashfox" as r;
  import "./surface.ashfox" as s;
  import "./body.ashfox" as b;
  import "./mount.ashfox" as m;
  export asset boss {
    settings { density = 16; forward = north; }
    skeleton = r.Adult;
    motion = r.idle;
    use b.Body as body {
      set length = 4u;
      bind skeleton = r.DragonRig;
      bind skin = s.scales;
    };
    use m.Mount as mount {
      bind skin = s.scales;
    };
    connect skeleton.wing -> mount.wing;
  }
}`;

const moduleDefinitions = [
  { subpath: './rig', path: 'rig.ashfox' },
  { subpath: './surface', path: 'surface.ashfox' },
  { subpath: './body', path: 'body.ashfox' },
  { subpath: './mount', path: 'mount.ashfox' }
] as const;

const moduleSources = (overrides: Readonly<Record<string, string>> = {}) => [
  { path: 'dragon/rig.ashfox', source: overrides.rig ?? rig },
  { path: 'dragon/surface.ashfox', source: overrides.surface ?? surface },
  { path: 'dragon/body.ashfox', source: overrides.body ?? body },
  { path: 'dragon/mount.ashfox', source: overrides.mount ?? mount }
];

/** Lock ABI pins are derived from the same parsed source states as the graph. */
const deriveInterfaceHashes = (
  workspace: AuthoredAssetWorkspace
): AuthoredAssetWorkspace => {
  const indexes = makeIndexes(workspace);
  const diagnostics: WorkspaceDiagnostic[] = [];
  const states = parseWorkspaceSources(indexes, diagnostics, withWorkspaceLimits(undefined));
  const abisByPackage = new Map<string, WorkspaceModuleAbi[]>();
  for (const [key, state] of states ?? []) {
    if (state.abi === undefined) continue;
    const separator = key.indexOf('\u0000');
    const packageName = key.slice(0, separator);
    const path = key.slice(separator + 1);
    const subpath = indexes.get(packageName)?.modulesByPath.get(path)?.subpath;
    if (subpath === undefined) continue;
    const abis = abisByPackage.get(packageName) ?? [];
    abis.push({ ...state.abi, subpath });
    abisByPackage.set(packageName, abis);
  }
  return {
    ...workspace,
    lock: {
      ...workspace.lock,
      packages: workspace.lock.packages.map((locked) => {
        const packageManifest = workspace.manifest.packages.find((pkg) => pkg.name === locked.name);
        return packageManifest === undefined ? locked : {
          ...locked,
          interfaceHash: computePackageInterfaceHash(packageManifest,
            abisByPackage.get(locked.name) ?? [])
        };
      })
    }
  };
};

const workspaceFor = (
  rootSource: string,
  overrides: Readonly<Record<string, string>> = {},
  extraFiles: readonly { readonly path: string; readonly source: string }[] = []
): AuthoredAssetWorkspace => {
  const extraModules = extraFiles.filter((file) => file.path !== 'dragon/main.ashfox')
    .map((file) => {
      const relative = file.path.replace(/^dragon\//u, '').replace(/\.ashfox$/u, '');
      return { subpath: './' + relative, path: relative + '.ashfox' };
    });
  return deriveInterfaceHashes(workspaceFixture([
    { path: 'dragon/main.ashfox', source: rootSource.replace(
      /^(asset|module) package \{/m, '$1 boss {') },
    ...moduleSources(overrides),
    ...extraFiles
  ], {
    root: 'dragon',
    packageName: 'dragon',
    entries: [{ name: 'boss', path: 'main.ashfox' }],
    modules: [...moduleDefinitions, ...extraModules]
  }));
};

const workspaceFailure = (
  workspace: AuthoredAssetWorkspace
): AssetHirResult => {
  const resolved = resolveWorkspaceEntryCompilation(workspace, {
    packageName: 'dragon', entryName: 'boss'
  });
  if (resolved.ok) return buildAssetHir(resolved.value.closure);
  return {
    ok: false,
    diagnostics: resolved.diagnostics.map((item) => ({
      severity: 'error' as const,
      code: item.code,
      message: item.message,
      path: item.source?.path ?? '',
      span: sourceSpan('', item.source?.start.offset ?? 0, item.source?.end.offset ?? 0)
    }))
  };
};

const compileWorkspace = (
  rootSource: string,
  overrides: Readonly<Record<string, string>> = {}
): AssetHirResult => workspaceFailure(workspaceFor(rootSource, overrides));

const codes = (source: string, path = 'test.ashfox'): string[] =>
  parseAssetSource(source, path).diagnostics.map((entry) => entry.code);

const valid = compileWorkspace(root);
assert.equal(valid.ok, true,
  valid.ok ? '' : valid.diagnostics.map((entry) => entry.code + ': ' + entry.message).join('; '));
if (valid.ok) {
  const hir = valid.hir;
  assert.equal(hir.rootPath, 'dragon/main.ashfox');
  assert.equal(Object.keys(hir.modules).length, 5);
  assert.equal(Object.keys(hir.assets).length, 1);
  assert.equal(Object.values(hir.assets)[0]!.settings.density.value.numerator, 16n);
  assert.equal(Object.values(hir.assets)[0]!.settings.density.value.denominator, 1n);
  assert.equal(Object.values(hir.assets)[0]!.settings.forward, 'north');
  assert.equal(Object.values(hir.rigs)[0]!.handedness, 'right');
  assert.deepEqual(Object.values(hir.rigs)[0]!.joints.root.channels, ['rotation', 'scale']);
  assert.equal(Object.values(hir.rigs)[0]!.sockets.wing.capacity, 'many');
  assert.equal(Object.values(hir.surfaceContracts)[0]!.charts.body.layout, 'box');
  assert.equal(Object.values(hir.surfaces)[0]!.textureSource?.kind,
    'unlowered-texture-source');
  assert.equal(Object.values(hir.components).length, 2);
  assert.equal(Object.values(hir.components).find((item) => item.symbol.name === 'Mount')!.socketBindings.length, 1);
  assert.equal(Object.values(hir.components).find((item) => item.symbol.name === 'Body')!.parameters.length, 'unit');
  assert.equal(Object.values(hir.motions)[0]!.fps.value.numerator, 24n);
  assert.equal(Object.keys(Object.values(hir.assets)[0]!.uses[0]!.parameters).length, 1);
  const instantiated = instantiateAsset(hir);
  assert.equal(instantiated.ok, true, instantiated.ok ? '' :
    instantiated.diagnostics.map((entry) => `${entry.code}: ${entry.message}`).join('; '));
  if (instantiated.ok) {
    assert.deepEqual(instantiated.ir.bones.map((bone) => bone.id), ['chest', 'root']);
    assert.deepEqual(instantiated.ir.instances.map((instance) => instance.id), ['body', 'mount']);
    assert.equal(instantiated.ir.connections.length, 1);
    assert.equal(instantiated.ir.connections[0]!.toInstance, 'mount');
    assert.equal(instantiated.ir.connections[0]!.parentBoneId, 'chest');
    assert.equal(instantiated.ir.connections[0]!.parentPlacement.origin[1]!.numerator, 2n);
    const ids = (nodes: typeof instantiated.ir.instances[number]['geometry']): string[] =>
      nodes.flatMap((node) => [node.id, ...ids(node.children)]);
    assert.deepEqual(ids(instantiated.ir.instances[0]!.geometry), [
      'body/root/body', 'body/root/private', 'body/root/private/detail'
    ]);
    assert.deepEqual(ids(instantiated.ir.instances[1]!.geometry), [
      'mount/anchor', 'mount/anchor/plate'
    ]);
    assert.equal(instantiated.ir.instances[0]!.placementAuthority, 'rig');
    assert.equal(instantiated.ir.instances[1]!.placementAuthority, 'socket');
    assert.equal(instantiated.ir.instances[1]!.placement.origin[1]!.numerator, 22n);
    assert.equal(instantiated.ir.motions[0]!.channels[0]!.targetBoneId, 'chest');
    assert.equal(instantiated.ir.surfaces.length, 1);
    assert.ok(Object.isFrozen(instantiated.ir));
  }
}

const missingHandedness = rig.replace('handedness = right;\n', '');
assert.ok(codes(missingHandedness).includes('asset.missing-handedness'));

const badFrame = rig.replace('x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1);',
  'x = (1, 0, 0); y = (1, 0, 0); z = (0, 0, 1);');
const badFrameResult = compileWorkspace(root, { rig: badFrame });
assert.equal(badFrameResult.ok, false);
if (!badFrameResult.ok) assert.ok(badFrameResult.diagnostics.some((entry) => entry.code === 'asset.invalid-frame'));

const rotatedSkeleton = rig.replace(
  `bind chest { parent-origin = (0u, 20u, 0u); ${frame} }`,
  'bind chest { parent-origin = (0u, 20u, 0u); frame { x = (0, 1, 0); y = (-1, 0, 0); z = (0, 0, 1); } }'
);
const rotatedHir = compileWorkspace(root, { rig: rotatedSkeleton });
assert.equal(rotatedHir.ok, true);
if (rotatedHir.ok) {
  const rotated = instantiateAsset(rotatedHir.hir);
  assert.equal(rotated.ok, true);
  if (rotated.ok) assert.deepEqual(rotated.ir.motions[0]!.channels[0]!.keys[1]!
    .value.values.map((entry) => entry.value.numerator), [0n, -10n, 0n]);
}

const badSurface = surface.replace('chart body box { width = 16px; height = 16px; coverage = opaque; }',
  'chart body flat { width = 16px; height = 16px; coverage = opaque; }');
const badSurfaceResult = compileWorkspace(root, { surface: badSurface });
assert.equal(badSurfaceResult.ok, false);
if (!badSurfaceResult.ok) assert.ok(badSurfaceResult.diagnostics.some((entry) =>
  entry.code === 'asset.surface-chart-layout' || entry.code === 'asset.chart-layout-mismatch'));

// The concrete socket endpoint intentionally differs from the nominal rig
// socket in both origin and basis; handedness is the only shared frame ABI.
assert.equal(valid.ok, true);

const mixedPlacementBody = body.replace(
  '    requires surface skin: s.Skin;\n',
  '    requires surface skin: s.Skin;\n    requires socket anchor: r.WingMount;\n');
const mixedPlacementResult = compileWorkspace(root, { body: mixedPlacementBody });
assert.equal(mixedPlacementResult.ok, false);
if (!mixedPlacementResult.ok) assert.ok(mixedPlacementResult.diagnostics.some((entry) =>
  entry.code === 'asset.component-placement'));

const emptyPlacementBody = body
  .replace('    requires rig skeleton: r.DragonRig;\n', '')
  .replace('    bind bone root to skeleton.root;\n', '');
const emptyPlacementResult = compileWorkspace(root, { body: emptyPlacementBody });
assert.equal(emptyPlacementResult.ok, false);
if (!emptyPlacementResult.ok) assert.ok(emptyPlacementResult.diagnostics.some((entry) =>
  entry.code === 'asset.component-placement'));

const escapedGeometryBody = body.replace(
  '    geometry {\n      bone root {',
  '    geometry {\n      cube escaped { origin = (0u, 0u, 0u); size = (2u, 2u, 2u); surface = skin.body; }\n      bone root {');
const escapedGeometryResult = compileWorkspace(root, { body: escapedGeometryBody });
assert.equal(escapedGeometryResult.ok, false);
if (!escapedGeometryResult.ok) assert.ok(escapedGeometryResult.diagnostics.some((entry) =>
  entry.code === 'asset.unanchored-geometry'));

const missingEndpointMount = mount.replace(
  `    bind socket wing to bone anchor { ${localSocketFrame} }\n`, '');
const missingEndpointResult = compileWorkspace(root, { mount: missingEndpointMount });
assert.equal(missingEndpointResult.ok, false);
if (!missingEndpointResult.ok) assert.ok(missingEndpointResult.diagnostics.some((entry) =>
  entry.code === 'asset.missing-socket-endpoint'));

const duplicateEndpointMount = mount.replace(
  `    bind socket wing to bone anchor { ${localSocketFrame} }\n`,
  `    bind socket wing to bone anchor { ${localSocketFrame} }\n    bind socket wing to bone anchor { ${localSocketFrame} }\n`);
const duplicateEndpointResult = compileWorkspace(root, { mount: duplicateEndpointMount });
assert.equal(duplicateEndpointResult.ok, false);
if (!duplicateEndpointResult.ok) assert.ok(duplicateEndpointResult.diagnostics.some((entry) =>
  entry.code === 'asset.duplicate-socket-binding'));

const outOfBoundsSurface = surface.replace(
  'chart body box { origin = (0px, 0px); }',
  'chart body box { origin = (60px, 60px); }');
const outOfBoundsResult = compileWorkspace(root, { surface: outOfBoundsSurface });
assert.equal(outOfBoundsResult.ok, false);
if (!outOfBoundsResult.ok) assert.ok(outOfBoundsResult.diagnostics.some((entry) =>
  entry.code === 'asset.chart-out-of-bounds'));

const fractionalOriginSurface = surface.replace(
  'chart body box { origin = (0px, 0px); }',
  'chart body box { origin = (0.5px, 0px); }');
const fractionalOriginResult = compileWorkspace(root, { surface: fractionalOriginSurface });
assert.equal(fractionalOriginResult.ok, false);
if (!fractionalOriginResult.ok) {
  const originDiagnostic = fractionalOriginResult.diagnostics.find((entry) =>
    entry.code === 'asset.invalid-chart-origin');
  assert.ok(originDiagnostic);
  assert.equal(originDiagnostic?.path, 'dragon/surface.ashfox');
  assert.ok((originDiagnostic?.span.start.offset ?? 0) > 0);
}

const extraChartSurface = surface.replace(
  '      chart body box { origin = (0px, 0px); }\n',
  '      chart body box { origin = (0px, 0px); }\n      chart extra flat { origin = (16px, 0px); }\n');
const extraChartResult = compileWorkspace(root, { surface: extraChartSurface });
assert.equal(extraChartResult.ok, false);
if (!extraChartResult.ok) assert.ok(extraChartResult.diagnostics.some((entry) =>
  entry.code === 'asset.unknown-chart'));

const coverageMismatchSurface = surface.replace(
  'chart body box { origin = (0px, 0px); }',
  'chart body box { origin = (0px, 0px); coverage = 1; }');
const coverageMismatchResult = compileWorkspace(root, { surface: coverageMismatchSurface });
assert.equal(coverageMismatchResult.ok, false);
if (!coverageMismatchResult.ok) assert.ok(coverageMismatchResult.diagnostics.some((entry) =>
  entry.code === 'asset.chart-coverage-mismatch'));

const noSocketConnection = root.replace('connect skeleton.wing -> mount.wing;\n', '');
const noSocketResult = compileWorkspace(noSocketConnection);
assert.equal(noSocketResult.ok, false);
if (!noSocketResult.ok) assert.ok(noSocketResult.diagnostics.some((entry) =>
  entry.code === 'asset.missing-socket-connection'));

const badMotion = rig.replace('      key 1s = (10deg, 0deg, 0deg) step;\n    }\n  }',
  '      key 1s = (10deg, 0deg, 0deg) step;\n    }\n    track chest.rotation { key 0s = (0deg, 0deg, 0deg) linear; key 1s = (10deg, 0deg, 0deg) step; }\n  }');
const badMotionResult = compileWorkspace(root, { rig: badMotion });
assert.equal(badMotionResult.ok, false);
if (!badMotionResult.ok) assert.ok(badMotionResult.diagnostics.some((entry) =>
  entry.code === 'asset.duplicate-motion-track' || entry.code === 'asset.invalid-motion-key'));

const badChannel = rig.replace('track chest.rotation', 'track chest.scale');
const badChannelResult = compileWorkspace(root, { rig: badChannel });
assert.equal(badChannelResult.ok, false);
if (!badChannelResult.ok) assert.ok(badChannelResult.diagnostics.some((entry) => entry.code === 'asset.motion-channel'));

const missingInterpolation = rig.replace('key 0s = (0deg, 0deg, 0deg) linear;',
  'key 0s = (0deg, 0deg, 0deg);');
assert.ok(codes(missingInterpolation).includes('asset.missing-interpolation'));

const badSettings = root.replace('density = 16;', 'density = 8;');
const badSettingsResult = compileWorkspace(badSettings);
assert.equal(badSettingsResult.ok, false);
if (!badSettingsResult.ok) assert.ok(badSettingsResult.diagnostics.some((entry) => entry.code === 'asset.invalid-settings'));

const moduleRoot = root.replace('asset package {', 'module package {');
const rootResult = workspaceFailure(workspaceFor(moduleRoot));
assert.equal(rootResult.ok, false);
if (!rootResult.ok) assert.ok(rootResult.diagnostics.some((entry) =>
  entry.code === 'workspace.entry.unit' || entry.code === 'workspace.source.unit_kind'));

const duplicatePathWorkspace = deriveInterfaceHashes(workspaceFixture([
  { path: 'dragon/main.ashfox', source: root.replace(
    /^(asset|module) package \{/m, '$1 boss {') },
  ...moduleSources(),
  { path: 'dragon/rig.ashfox', source: rig }
], {
  root: 'dragon',
  packageName: 'dragon',
  entries: [{ name: 'boss', path: 'main.ashfox' }],
  modules: moduleDefinitions
}));
const duplicatePath = workspaceFailure(duplicatePathWorkspace);
assert.equal(duplicatePath.ok, false);
if (!duplicatePath.ok) assert.ok(duplicatePath.diagnostics.some((entry) =>
  entry.code === 'workspace.file.duplicate' || entry.code === 'workspace.contract.duplicate_lock_file'));

const duplicateParameter = root.replace('set length = 4u;', 'set length = 4u;\n      set length = 5u;');
const duplicateParameterResult = compileWorkspace(duplicateParameter);
assert.equal(duplicateParameterResult.ok, false);
if (!duplicateParameterResult.ok) assert.ok(duplicateParameterResult.diagnostics.some((entry) => entry.code === 'asset.duplicate-parameter-set'));

const workspaceWithUnrelated = workspaceFor(root, {}, [
  { path: 'dragon/unrelated.ashfox', source: 'ashfox-model 1\nmodule unrelated {}' }
]);
const unrelatedResult = resolveWorkspaceEntryCompilation(workspaceWithUnrelated, {
  packageName: 'dragon', entryName: 'boss'
});
assert.equal(unrelatedResult.ok, true);
if (!unrelatedResult.ok) throw new Error('workspace with unrelated file should resolve');
const baselineResult = resolveWorkspaceEntryCompilation(workspaceFor(root), {
  packageName: 'dragon', entryName: 'boss'
});
assert.equal(baselineResult.ok, true);
if (!baselineResult.ok) throw new Error('baseline workspace should resolve');
assert.deepEqual(
  unrelatedResult.value.closure.files.map((file) => file.identity.key),
  baselineResult.value.closure.files.map((file) => file.identity.key)
);

const aliasRenamedRoot = root.replace(' as r;', ' as rigAlias;')
  .replace('r.DragonRig', 'rigAlias.DragonRig')
  .replace('r.Adult', 'rigAlias.Adult')
  .replace('r.idle', 'rigAlias.idle')
  .replace('r.WingMount', 'rigAlias.WingMount');
const aliasBaseline = buildAssetHir(baselineResult.value.closure);
const aliasResolved = resolveWorkspaceEntryCompilation(workspaceFor(aliasRenamedRoot), {
  packageName: 'dragon', entryName: 'boss'
});
assert.equal(aliasResolved.ok, true);
if (!aliasResolved.ok) throw new Error('alias-renamed workspace should resolve');
const aliasHir = buildAssetHir(aliasResolved.value.closure);
assert.equal(aliasBaseline.ok, true);
assert.equal(aliasHir.ok, true);
if (aliasBaseline.ok && aliasHir.ok) {
  assert.deepEqual(Object.keys(aliasHir.hir.symbols).sort(), Object.keys(aliasBaseline.hir.symbols).sort());
}

const exactEntryMismatch = resolveWorkspaceEntryCompilation(workspaceFor(
  root.replace('asset package {', 'asset other {')
), { packageName: 'dragon', entryName: 'boss' });
assert.equal(exactEntryMismatch.ok, false);
if (!exactEntryMismatch.ok) assert.ok(exactEntryMismatch.diagnostics.some((entry) =>
  entry.code === 'workspace.entry.identity'));
