import { buildAssetHir } from '../../../src/compiler/program/asset/hir';
import type { AssetHirResult } from '../../../src/compiler/program/asset/contract';
import { parseAssetSource } from '../../../src/project/program/asset/parse';
import { sourceSpan } from '../../../src/project/source/lexer';
import {
  computePackageInterfaceHash,
  type AuthoredAssetWorkspace,
  type WorkspaceModuleAbi,
  type WorkspaceDiagnostic,
  withWorkspaceLimits,
} from '../../../src/project/workspace';
import { makeIndexes, parseWorkspaceSources } from '../../../src/project/workspace/graphSource';
import { resolveWorkspaceEntryCompilation } from '../../../src/project/workspace/graph';
import { workspaceFixture } from '../../project/workspace/fixtures';

export const frame = 'frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }';
// A concrete endpoint may choose a different local origin and basis while
// retaining the socket contract's declared handedness.
export const localSocketFrame =
  'frame { origin = (2u, 0u, 0u); x = (0, 1, 0); y = (-1, 0, 0); z = (0, 0, 1); }';

export const rig = `ashfox 1
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
    bind root { parent_origin = (0u, 0u, 0u); ${frame} }
    bind chest { parent_origin = (0u, 20u, 0u); ${frame} }
  }
  export motion idle for DragonRig {
    duration = 1s;
    fps = 24;
    loop = loop;
    rest_relative = true;
    track chest.rotation {
      key 0s = (0deg, 0deg, 0deg) linear;
      key 1s = (10deg, 0deg, 0deg) step;
    }
  }
}`;

export const surface = `ashfox 1
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

export const body = `ashfox 1
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

export const mount = `ashfox 1
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

export const root = `ashfox 1
model boss {
  import "./rig.ashfox" as r;
  import "./surface.ashfox" as s;
  import "./body.ashfox" as b;
  import "./mount.ashfox" as m;
  settings { density = 16; forward = north; }
  skeleton = r.Adult;
  motions = [r.idle];
  use b.Body as body {
    length = 4u;
    skeleton = r.DragonRig;
    skin = s.scales;
  }
  use m.Mount as mount {
    skin = s.scales;
  }
  connect skeleton.wing -> mount.wing;
}`;

export const moduleDefinitions = [
  { subpath: './rig', path: 'rig.ashfox' },
  { subpath: './surface', path: 'surface.ashfox' },
  { subpath: './body', path: 'body.ashfox' },
  { subpath: './mount', path: 'mount.ashfox' },
] as const;

export const moduleSources = (overrides: Readonly<Record<string, string>> = {}) => [
  { path: 'dragon/rig.ashfox', source: overrides.rig ?? rig },
  { path: 'dragon/surface.ashfox', source: overrides.surface ?? surface },
  { path: 'dragon/body.ashfox', source: overrides.body ?? body },
  { path: 'dragon/mount.ashfox', source: overrides.mount ?? mount },
];

/** Lock ABI pins are derived from the same parsed source states as the graph. */
export const deriveInterfaceHashes = (
  workspace: AuthoredAssetWorkspace,
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
        return packageManifest === undefined
          ? locked
          : {
              ...locked,
              interfaceHash: computePackageInterfaceHash(
                packageManifest,
                abisByPackage.get(locked.name) ?? [],
              ),
            };
      }),
    },
  };
};

export const workspaceFor = (
  rootSource: string,
  overrides: Readonly<Record<string, string>> = {},
  extraFiles: readonly { readonly path: string; readonly source: string }[] = [],
): AuthoredAssetWorkspace => {
  const extraModules = extraFiles
    .filter((file) => file.path !== 'dragon/main.ashfox')
    .map((file) => {
      const relative = file.path.replace(/^dragon\//u, '').replace(/\.ashfox$/u, '');
      return { subpath: './' + relative, path: relative + '.ashfox' };
    });
  return deriveInterfaceHashes(
    workspaceFixture(
      [
        {
          path: 'dragon/main.ashfox',
          source: rootSource.replace(/^(model|module) package \{/m, '$1 boss {'),
        },
        ...moduleSources(overrides),
        ...extraFiles,
      ],
      {
        root: 'dragon',
        packageName: 'dragon',
        entries: [{ name: 'boss', path: 'main.ashfox' }],
        modules: [...moduleDefinitions, ...extraModules],
      },
    ),
  );
};

export const workspaceFailure = (workspace: AuthoredAssetWorkspace): AssetHirResult => {
  const resolved = resolveWorkspaceEntryCompilation(workspace, {
    packageName: 'dragon',
    entryName: 'boss',
  });
  if (resolved.ok) return buildAssetHir(resolved.value.closure);
  return {
    ok: false,
    diagnostics: resolved.diagnostics.map((item) => ({
      severity: 'error' as const,
      code: item.code,
      message: item.message,
      path: item.source?.path ?? '',
      span: sourceSpan('', item.source?.start.offset ?? 0, item.source?.end.offset ?? 0),
    })),
  };
};

export const compileWorkspace = (
  rootSource: string,
  overrides: Readonly<Record<string, string>> = {},
): AssetHirResult => workspaceFailure(workspaceFor(rootSource, overrides));

export const codes = (source: string, path = 'test.ashfox'): string[] =>
  parseAssetSource(source, path).diagnostics.map((entry) => entry.code);
