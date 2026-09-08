import {
  ASHFOX_LOCK_FORMAT,
  ASHFOX_PACKAGE_FORMAT,
  ASHFOX_WORKSPACE_COMPILER_FINGERPRINT,
  ASHFOX_WORKSPACE_FORMAT,
  ASHFOX_WORKSPACE_VERSION,
  computePackageContentHash,
  computePackageInterfaceHash,
  computePackageManifestHash,
  computeSourceContentHash,
  openAssetProject,
  type AssetProject,
  type AuthoredAssetWorkspace,
  type WorkspaceFile,
  type WorkspacePackage
} from '@ashfox/engine-core';
import { INITIAL_WORKBENCH_PROJECT_ID } from '../../application/projectIdentity';

/* A small complete asset keeps the first render deterministic until a file is
 * opened. The workspace, rather than a synthetic ProjectDocument, is the sole
 * initial authority. */
const INITIAL_SOURCE = `ashfox-model 1
asset workbench {
  export rig contract WorkbenchRig {
    handedness = right;
    frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
    joint root {
      parent = none;
      role = root;
      frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
      channels = (rotation, scale);
      mirror = none;
    }
  }
  export skeleton WorkbenchSkeleton implements WorkbenchRig {
    bind root { parent-origin = (0u, 0u, 0u); frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } }
  }
  export motion idle for WorkbenchRig {
    duration = 1s;
    fps = 20;
    loop = loop;
    rest-relative = true;
    track root.rotation {
      key 0s = (0deg, 0deg, 0deg) linear;
      key 1s = (0deg, 0deg, 0deg) linear;
    }
  }
  export surface contract WorkbenchSurface {
    atlas { width = 16px; height = 8px; }
    chart body box { width = 16px; height = 8px; coverage = opaque; }
    material = opaque;
  }
  export surface workbenchSurface: WorkbenchSurface {
    material = opaque;
    texture atlas {
      atlas = (16px, 8px);
      background = shadow;
      background-alpha = 255;
      palette { shadow = #4a170f; body = (#4a170f, #a83a1f, #e06b32); }
      chart body box { origin = (0px, 0px); fill = body; }
      grain clustered { seed = 23; }
      tone voxel;
    }
  }
  export component WorkbenchBody {
    requires rig skeleton: WorkbenchRig;
    requires surface skin: WorkbenchSurface;
    bind bone root to skeleton.root;
    geometry {
      bone root {
        cube body {
          origin = (-2u, 0u, -2u);
          size = (4u, 4u, 4u);
          surface = skin.body;
        }
      }
    }
  }
  export asset workbench {
    settings { density = 16; forward = north; }
    skeleton = WorkbenchSkeleton;
    motion = idle;
    use WorkbenchBody as body { bind skeleton = WorkbenchRig; bind skin = workbenchSurface; };
  }
}`;

const initialPackage = (): WorkspacePackage => ({
  name: 'workbench',
  root: 'workbench',
  manifest: {
    format: ASHFOX_PACKAGE_FORMAT,
    version: ASHFOX_WORKSPACE_VERSION,
    entries: [{ name: 'workbench', path: 'main.ashfox' }],
    modules: [],
    dependencies: []
  }
});

const initialWorkspace = (): AuthoredAssetWorkspace => {
  const pkg = initialPackage();
  const files: readonly WorkspaceFile[] = [
    { path: 'workbench/main.ashfox', source: INITIAL_SOURCE }
  ];
  const locked = {
    name: pkg.name,
    source: 'workspace' as const,
    digest: null,
    root: pkg.root,
    manifest: pkg.manifest,
    contentHash: computePackageContentHash(pkg, files),
    manifestHash: computePackageManifestHash(pkg),
    files: files.map((file) => ({
      path: file.path,
      contentHash: computeSourceContentHash(file.source)
    })),
    interfaceHash: computePackageInterfaceHash(pkg),
    dependencies: []
  };
  return {
    files,
    manifest: {
      format: ASHFOX_WORKSPACE_FORMAT,
      version: ASHFOX_WORKSPACE_VERSION,
      packages: [pkg]
    },
    lock: {
      format: ASHFOX_LOCK_FORMAT,
      version: ASHFOX_WORKSPACE_VERSION,
      compilerFingerprint: ASHFOX_WORKSPACE_COMPILER_FINGERPRINT,
      packages: [locked]
    }
  };
};

export const createBlankWorkbenchProject = (createdAt: string): AssetProject => {
  const opened = openAssetProject({
    workspace: initialWorkspace(),
    entry: { packageName: 'workbench', entryName: 'workbench' },
    identity: {
      id: INITIAL_WORKBENCH_PROJECT_ID,
      revision: 'local-0001',
      createdAt,
      updatedAt: createdAt
    }
  });
  if (!opened.ok) {
    throw new Error(opened.diagnostics[0]?.message ?? 'Blank workspace failed to open.');
  }
  return opened.project;
};
