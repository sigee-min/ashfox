import assert from 'node:assert/strict';

import { adaptProjectForExport, type ExportAdaptedDocument } from '../../src/export/adapter';
import { ProjectExportError } from '../../src/export/contract';
import {
  validateExportTarget,
  validateAssetProjectExportTarget,
} from '../../src/export/pipeline/validate';
import * as geckoApi from '../../src/export/targets/geckolib5/exporter';
import { buildGltf, exportGltf } from '../../src/export/targets/gltf/exporter';
import { createGltfBundle } from '../../src/export/targets/gltf/bundle';
import {
  buildMinecraftJavaModel,
  exportMinecraftJavaBlock,
} from '../../src/export/targets/javaBlock/exporter';
import {
  buildMinecraftJavaBlockState,
  buildMinecraftJavaPackMetadata,
} from '../../src/export/targets/javaBlock/pack';
import type { AssetProject } from '../../src/project/asset';
import { exportProject } from './fixture';

const project = exportProject(undefined, 'profile-snapshot');
const oversizedAnimationProject: AssetProject = {
  ...project,
  document: structuredClone(project.document),
};
const oversizedClipId = 'oversized';
oversizedAnimationProject.document.animations = {
  [oversizedClipId]: {
    id: oversizedClipId,
    name: oversizedClipId,
    durationSeconds: Number.MAX_VALUE,
    fps: Number.MAX_VALUE,
    loop: 'once',
    channels: {},
    triggers: {},
  },
};
const oversizedTarget = adaptProjectForExport(oversizedAnimationProject.document, {
  target: 'glb',
  modelPath: 'oversized_animation',
});
let oversizedTargetError: ProjectExportError | undefined;
assert.throws(
  () =>
    validateExportTarget(oversizedTarget, {
      profileId: 'gltf.2',
      errorMessage: 'oversized animation validation failed.',
    }),
  (error: unknown) => {
    if (!(error instanceof ProjectExportError)) return false;
    oversizedTargetError = error;
    return true;
  },
);
assert.ok(
  oversizedTargetError?.findings.some(
    (finding) =>
      finding.code === 'format.unsupported_data' &&
      finding.path === `animations.${oversizedClipId}.durationSeconds`,
  ),
  'Target preflight must reject unbounded duration*FPS before a builder allocates samples.',
);
const validTargetReport = validateAssetProjectExportTarget(project, {
  target: 'glb',
  modelPath: 'project_preflight',
});
assert.equal(validTargetReport.valid, true);

const hiddenAnimationProject: AssetProject = {
  ...project,
  id: 'profile-snapshot-hidden-animation',
  document: structuredClone(project.document),
};
hiddenAnimationProject.document.scene.nodes = {
  ...hiddenAnimationProject.document.scene.nodes,
  root: {
    ...hiddenAnimationProject.document.scene.nodes.root!,
    visible: false,
  },
};
hiddenAnimationProject.document.animations = {
  idle: {
    id: 'idle',
    name: 'idle',
    durationSeconds: 1,
    fps: 1,
    loop: 'once',
    channels: {
      rotate: {
        id: 'rotate',
        targetNodeId: 'root',
        property: 'rotation',
        rotationSpace: 'bone',
        keys: [
          {
            id: 'key',
            timeSeconds: 0,
            value: [0, 0, 0],
            interpolation: 'linear',
          },
        ],
      },
    },
    triggers: {},
  },
};
for (const [target, profileId, targetName] of [
  ['glb', 'gltf.2', 'glTF'],
  ['bedrock', 'minecraft.bedrock', 'Bedrock'],
  ['geckolib5', 'minecraft.java.geckolib5', 'GeckoLib 5'],
] as const) {
  const adapted =
    target === 'glb'
      ? adaptProjectForExport(hiddenAnimationProject.document, {
          target: 'glb',
          modelPath: 'hidden_animation',
        })
      : adaptProjectForExport(hiddenAnimationProject.document, {
          target,
          namespace: 'ashfox',
          modelPath: 'hidden_animation',
        });
  assert.throws(
    () =>
      validateExportTarget(adapted, {
        profileId,
        errorMessage: `${targetName} hidden animation validation failed.`,
      }),
    (error: unknown) =>
      error instanceof ProjectExportError &&
      error.findings.filter(
        (finding) =>
          finding.code === 'format.unsupported_data' &&
          finding.path.startsWith('animations.idle.channels.') &&
          finding.message.includes(targetName) &&
          finding.message.includes('hidden'),
      ).length === 1,
    `${targetName} must reject hidden animation targets instead of dropping them.`,
  );
}
assert.equal('buildGeckoLib5Geometry' in geckoApi, false);
assert.equal(
  'buildGeckoLib5Animations' in geckoApi,
  false,
  'Unsealed Gecko builders must not remain deep-callable.',
);

const glb = adaptProjectForExport(project.document, {
  target: 'glb',
  modelPath: 'profile_snapshot',
});
assert.throws(() => buildGltf(glb), /sealed validated/u);
const validatedGlb = validateExportTarget(glb, {
  profileId: 'gltf.2',
  errorMessage: 'glTF validation failed.',
});
assert.notEqual(validatedGlb.document, glb);
assert.equal(Object.isFrozen(validatedGlb.document), true);
assert.equal(Object.isFrozen(validatedGlb.profile), true);
assert.equal(buildGltf(validatedGlb.document).document.asset.version, '2.0');
assert.throws(
  () => buildGltf({ ...validatedGlb.document }),
  /sealed validated/u,
  'A shallow document clone must lose the target seal.',
);
const gltfCompiled = buildGltf(validatedGlb.document);
assert.doesNotThrow(() =>
  createGltfBundle(validatedGlb.document, project.build, gltfCompiled, validatedGlb.findings),
);
assert.throws(
  () =>
    createGltfBundle(
      { ...validatedGlb.document },
      project.build,
      gltfCompiled,
      validatedGlb.findings,
    ),
  /sealed validated/u,
);
Reflect.set(glb.formatProfile, 'version', '9.9');
assert.equal(
  buildGltf(validatedGlb.document).document.asset.version,
  '2.0',
  'Mutation of the caller profile must not change a sealed build.',
);

let nestedReads = 0;
const accessorScene = { ...glb.scene };
Object.defineProperty(accessorScene, 'nodes', {
  enumerable: true,
  get: () => {
    nestedReads += 1;
    return glb.scene.nodes;
  },
});
assert.throws(
  () =>
    validateExportTarget({ ...glb, scene: accessorScene } as never, {
      profileId: 'gltf.2',
      errorMessage: 'nested accessor',
    }),
  (error: unknown) =>
    error instanceof ProjectExportError &&
    error.findings.some((finding) => finding.path === 'document.scene.nodes'),
);
assert.equal(nestedReads, 0, 'A nested document accessor must reject without one attacker read.');

const sparseRoots = [...glb.scene.roots];
delete sparseRoots[0];
assert.throws(
  () =>
    validateExportTarget(
      {
        ...glb,
        scene: {
          ...glb.scene,
          roots: sparseRoots,
        },
      } as never,
      { profileId: 'gltf.2', errorMessage: 'sparse roots' },
    ),
  (error: unknown) =>
    error instanceof ProjectExportError &&
    error.findings.some((finding) => finding.path === 'document.scene.roots'),
);

const gecko = adaptProjectForExport(project.document, {
  target: 'geckolib5',
  namespace: 'ashfox',
  modelPath: 'profile_snapshot',
});
const validatedGecko = validateExportTarget(gecko, {
  profileId: 'minecraft.java.geckolib5',
  errorMessage: 'GeckoLib validation failed.',
});
assert.throws(
  () => buildGltf(validatedGecko.document),
  /sealed validated/u,
  'A cross-target validated document must not satisfy another builder.',
);

const java = adaptProjectForExport(project.document, {
  target: 'java_block',
  namespace: 'ashfox',
  modelPath: 'profile_snapshot',
});
assert.throws(() => buildMinecraftJavaModel(java), /sealed validated/u);
assert.throws(() => buildMinecraftJavaBlockState(java), /sealed validated/u);
assert.throws(() => buildMinecraftJavaPackMetadata(java), /sealed validated/u);

const profileAccessorAttack = (
  base: ExportAdaptedDocument,
  exportTarget: (document: ExportAdaptedDocument, build: AssetProject['build']) => unknown,
): void => {
  let reads = 0;
  const forged = { ...base };
  Object.defineProperty(forged, 'formatProfile', {
    enumerable: true,
    get: () => {
      reads += 1;
      return reads < 3
        ? base.formatProfile
        : {
            ...base.formatProfile,
            version: '9.9.9',
            modelPath: 'swapped',
          };
    },
  });
  assert.throws(
    () => exportTarget(forged as ExportAdaptedDocument, project.build),
    (error: unknown) =>
      error instanceof ProjectExportError &&
      error.findings.some((finding) => finding.path === 'formatProfile'),
  );
  assert.equal(reads, 0, 'A document profile accessor must reject without one attacker read.');
};
profileAccessorAttack(gecko, geckoApi.exportGeckoLib5);
profileAccessorAttack(
  adaptProjectForExport(project.document, {
    target: 'glb',
    modelPath: 'profile_accessor',
  }),
  exportGltf,
);
profileAccessorAttack(java, exportMinecraftJavaBlock);

let fieldReads = 0;
const accessorProfile = { ...gecko.formatProfile } as Record<string, unknown>;
Object.defineProperty(accessorProfile, 'geometryFormatVersion', {
  enumerable: true,
  get: () => {
    fieldReads += 1;
    return '1.12.0';
  },
});
assert.throws(
  () =>
    geckoApi.exportGeckoLib5({ ...gecko, formatProfile: accessorProfile } as never, project.build),
  (error: unknown) =>
    error instanceof ProjectExportError &&
    error.findings.some((finding) => finding.path === 'formatProfile.geometryFormatVersion'),
);
assert.equal(fieldReads, 0);

assert.equal(Object.prototype.hasOwnProperty.call(gecko.formatProfile, 'version'), false);
let retiredVersionReads = 0;
for (const [profile, path] of [
  [{ ...gecko.formatProfile, version: '5' }, 'formatProfile'],
  [
    (() => {
      const value = { ...gecko.formatProfile } as Record<string, unknown>;
      Object.defineProperty(value, 'version', {
        enumerable: false,
        value: '5',
      });
      return value;
    })(),
    'formatProfile.version',
  ],
  [
    (() => {
      const value = { ...gecko.formatProfile } as Record<string, unknown>;
      Object.defineProperty(value, 'version', {
        enumerable: true,
        get: () => {
          retiredVersionReads += 1;
          return '5';
        },
      });
      return value;
    })(),
    'formatProfile.version',
  ],
  [{ ...gecko.formatProfile, [Symbol('version')]: '5' }, 'formatProfile'],
] as const)
  assert.throws(
    () => geckoApi.exportGeckoLib5({ ...gecko, formatProfile: profile } as never, project.build),
    (error: unknown) =>
      error instanceof ProjectExportError &&
      error.findings.some((finding) => finding.path === path),
  );
assert.equal(
  retiredVersionReads,
  0,
  'The retired Gecko version accessor must reject without being invoked.',
);

for (const profile of [
  { ...gecko.formatProfile, extra: true },
  Object.assign(Object.create(null), gecko.formatProfile),
  (() => {
    const value = { ...gecko.formatProfile };
    Object.defineProperty(value, 'hidden', { value: true });
    return value;
  })(),
  (() => ({ ...gecko.formatProfile, [Symbol('foreign')]: true }))(),
])
  assert.throws(
    () => geckoApi.exportGeckoLib5({ ...gecko, formatProfile: profile } as never, project.build),
    ProjectExportError,
  );
for (const id of ['toString', 'constructor', '__proto__']) {
  assert.throws(
    () =>
      geckoApi.exportGeckoLib5(
        { ...gecko, formatProfile: { ...gecko.formatProfile, id } } as never,
        project.build,
      ),
    (error: unknown) =>
      error instanceof ProjectExportError &&
      error.findings.some((finding) => finding.path === 'formatProfile.id'),
  );
}

let targetReads = 0;
const target = { errorMessage: 'forged' } as Record<string, unknown>;
Object.defineProperty(target, 'profileId', {
  enumerable: true,
  get: () => {
    targetReads += 1;
    return 'gltf.2';
  },
});
assert.throws(() => validateExportTarget(glb, target as never), /own enumerable data fields/u);
assert.equal(targetReads, 0, 'The requested target cannot self-attest through an accessor.');
for (const forged of [
  { profileId: 'gltf.2', errorMessage: 'forged', extra: true },
  { profileId: 'gltf.2', errorMessage: 'forged', [Symbol('foreign')]: true },
  Object.assign(Object.create(null), {
    profileId: 'gltf.2',
    errorMessage: 'forged',
  }),
])
  assert.throws(
    () => validateExportTarget(glb, forged as never),
    /exact plain data object|exactly two current fields/u,
  );

console.log('export profile one-shot snapshot and builder seal ok');
